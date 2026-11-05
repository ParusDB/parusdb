import { createClient } from "@/lib/supabase/server";
import { runAgent, generateConversationTitle } from "@/lib/agent-runner";
import { DEFAULT_MODEL } from "@/lib/ollama";
import { createOllamaBackend, type LlmBackend } from "@/lib/llm";
import { resolveProviderBackend } from "@/lib/providers";
import { readableCatalogNames } from "@/lib/rbac";
import { DEFAULT_CATALOG } from "@/lib/polaris";
import { NextResponse } from "next/server";

// Génération de la réponse d'un agent. Le BFF orchestre le LLM configuré
// (Ollama local ou fournisseur par clé API, function calling) et mcp-trino
// (lecture seule), persiste les messages dans PostgreSQL (schéma `chat`) et
// diffuse la progression en temps réel via **Supabase Realtime** : une ligne
// `chat.stream_events` par évènement (statut, outil, fragment de réponse,
// fin), que le navigateur reçoit par abonnement postgres_changes. Le client
// ne dépend pas du corps de la réponse HTTP : il s'abonne AVANT d'appeler
// cette route.

interface StreamEventPayload {
  label?: string;
  tool?: string;
  query?: string;
  ok?: boolean;
  text?: string;
  message?: string;
  messageId?: string | null;
  title?: string | null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let content = "";
  try {
    const body = (await request.json()) as { content?: string };
    content = (body.content ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }
  if (!content) {
    return NextResponse.json({ error: "Message vide." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  // RLS : le propriétaire a tous les droits ; les rôles bénéficiaires d'un
  // partage ont la lecture seule - l'envoi est refusé ici explicitement.
  const { data: conversation } = await supabase
    .schema("chat")
    .from("conversations")
    .select("id, title, agent_id, owner_id")
    .eq("id", id)
    .maybeSingle();
  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation introuvable." },
      { status: 404 },
    );
  }
  if (conversation.owner_id !== user.id) {
    return NextResponse.json(
      {
        error:
          "Cette conversation est partagée avec vous en lecture seule : seul son propriétaire peut y écrire.",
      },
      { status: 403 },
    );
  }

  const { data: agent } = await supabase
    .schema("agents")
    .from("agents")
    .select("id, name, model_provider, model_id, system_prompt")
    .eq("id", conversation.agent_id)
    .maybeSingle();
  if (!agent) {
    return NextResponse.json(
      { error: "L'agent associé n'est plus disponible." },
      { status: 404 },
    );
  }

  // Historique (avant le message courant).
  const { data: historyRows } = await supabase
    .schema("chat")
    .from("messages")
    .select("role, content")
    .eq("conversation_id", id)
    .order("created_at", { ascending: false })
    .limit(20);
  const history = (historyRows ?? [])
    .slice()
    .reverse()
    .map((m: { role: string; content: string }) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content,
    }));

  // Persistance du message utilisateur + purge des évènements d'un
  // précédent aller-retour (transitoires).
  const { error: userInsertError } = await supabase
    .schema("chat")
    .from("messages")
    .insert({ conversation_id: id, role: "user", content, metadata: {} });
  if (userInsertError) {
    return NextResponse.json(
      { error: `L'enregistrement du message a échoué : ${userInsertError.message}` },
      { status: 500 },
    );
  }
  await supabase
    .schema("chat")
    .from("stream_events")
    .delete()
    .eq("conversation_id", id);

  // Diffusion Realtime : une insertion d'évènement par étape.
  const events = supabase.schema("chat").from("stream_events");
  const emit = async (kind: string, payload: StreamEventPayload) => {
    const { error } = await events.insert({ conversation_id: id, kind, payload });
    if (error) {
      throw new Error(
        `La diffusion temps réel a échoué : ${error.message}`,
      );
    }
  };

  let answer = "";
  let metadata: Record<string, unknown> = {};
  let errorMessage: string | null = null;
  let modelLabel = agent.model_id;

  try {
    // Source du modèle : Ollama (local) ou fournisseur par clé API
    // (/admin/providers) - la clé est déchiffrée côté serveur uniquement.
    // L'API reçoit l'identifiant de modèle nu ; le nom du fournisseur ne
    // sert qu'au libellé de traçabilité.
    let backend: LlmBackend;
    let model: string;
    if (agent.model_provider === "ollama") {
      backend = createOllamaBackend();
      model = agent.model_id || DEFAULT_MODEL;
      modelLabel = model;
    } else {
      const provider = await resolveProviderBackend(agent.model_provider);
      backend = provider.backend;
      model = agent.model_id;
      modelLabel = `${provider.name}/${agent.model_id}`;
    }
    // Périmètre RBAC du rôle actif (lib/rbac.ts, filtré par RLS) : le LLM ne
    // voit et n'interroge que les catalogues accessibles à l'utilisateur.
    // Null si indisponible : le comportement revient au périmètre du compte
    // de service mcp-trino (jamais bloquant pour répondre).
    let allowedCatalogs: string[] | null = null;
    try {
      allowedCatalogs = await readableCatalogNames();
    } catch {
      allowedCatalogs = null;
    }
    const result = await runAgent({
      model,
      modelLabel,
      backend,
      agentSystemPrompt: agent.system_prompt,
      history,
      userMessage: content,
      allowedCatalogs,
      onEvent: (event) => {
        if (event.type === "status") {
          return emit("status", { label: event.label });
        }
        if (event.type === "tool") {
          return emit("tool", { tool: event.tool, query: event.query });
        }
        if (event.type === "tool_result") {
          return emit("tool_result", { tool: event.tool, ok: event.ok });
        }
      },
    });
    answer = result.content;
    metadata = result.metadata;

    // Fragments de la réponse finale, diffusés au fil de l'eau.
    const chunks = answer.match(/[\s\S]{1,48}/g) ?? [answer];
    for (const chunk of chunks) {
      await emit("token", { text: chunk });
    }
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Erreur inattendue de l'agent.";
    await emit("error", { message: errorMessage });
    answer = `La réponse a échoué : ${errorMessage}`;
    metadata = { model: modelLabel, error: errorMessage };
  }

  // Persistance du message assistant (traçabilité sans fuite de secrets,
  // AGENTS.md §11 : durées, modèle, tokens).
  const { data: assistantMessage } = await supabase
    .schema("chat")
    .from("messages")
    .insert({ conversation_id: id, role: "assistant", content: answer, metadata })
    .select("id")
    .single();

  // Requêtes SQL exécutées via mcp-trino : journalisées pour la traçabilité
  // et l'audit.
  const traces = (metadata.tool_calls as
    | { name: string; query?: string; ok: boolean }[]
    | undefined) ?? [];
  for (const trace of traces) {
    if (!trace.query) continue;
    await supabase.schema("lakehouse").from("query_history").insert({
      user_id: user.id,
      catalog_name: DEFAULT_CATALOG,
      query: trace.query,
      status: trace.ok ? "success" : "error",
    });
  }

  // Titre généré par l'IA à partir des 2 premiers échanges.
  let newTitle: string | null = conversation.title;
  if (!conversation.title) {
    try {
      const provider =
        agent.model_provider === "ollama"
          ? null
          : await resolveProviderBackend(agent.model_provider);
      newTitle = await generateConversationTitle({
        model: agent.model_id || DEFAULT_MODEL,
        backend: provider ? provider.backend : createOllamaBackend(),
        question: content,
        answer,
      });
    } catch {
      newTitle = content.replace(/\s+/g, " ").trim().slice(0, 48);
    }
    await supabase
      .schema("chat")
      .from("conversations")
      .update({ title: newTitle })
      .eq("id", id);
  }
  // Rafraîchit updated_at de la conversation.
  await supabase
    .schema("chat")
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);

  await emit("done", {
    messageId: assistantMessage?.id ?? null,
    text: answer,
    title: newTitle,
  });

  return NextResponse.json({
    ok: true,
    text: answer,
    title: newTitle,
    error: errorMessage ?? undefined,
  });
}
