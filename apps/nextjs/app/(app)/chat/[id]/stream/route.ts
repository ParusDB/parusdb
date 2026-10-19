import { createClient } from "@/lib/supabase/server";
import { runAgent, generateConversationTitle } from "@/lib/agent-runner";
import { DEFAULT_MODEL } from "@/lib/ollama";
import { NextResponse } from "next/server";

// Génération de la réponse d'un agent. Le BFF orchestre Ollama (function
// calling) et mcp-trino (lecture seule), persiste les messages dans
// PostgreSQL (schéma `chat`) et diffuse la progression en temps réel via
// **Supabase Realtime** : une ligne `chat.stream_events` par évènement
// (statut, outil, fragment de réponse, fin), que le navigateur reçoit par
// abonnement postgres_changes. Le client ne dépend pas du corps de la
// réponse HTTP : il s'abonne AVANT d'appeler cette route.

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

  // RLS : seul le propriétaire voit la conversation.
  const { data: conversation } = await supabase
    .schema("chat")
    .from("conversations")
    .select("id, title, agent_id")
    .eq("id", id)
    .maybeSingle();
  if (!conversation) {
    return NextResponse.json(
      { error: "Conversation introuvable." },
      { status: 404 },
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

  try {
    if (agent.model_provider !== "ollama") {
      throw new Error(
        "Ce dialogue requiert l'exécution d'un modèle propriétaire, non prise en charge dans cette version. Configurez un modèle Ollama pour cet agent.",
      );
    }
    const result = await runAgent({
      model: agent.model_id || DEFAULT_MODEL,
      agentSystemPrompt: agent.system_prompt,
      history,
      userMessage: content,
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
    metadata = { model: agent.model_id, error: errorMessage };
  }

  // Persistance du message assistant (traçabilité sans fuite de secrets,
  // AGENTS.md §11 : durées, modèle, tokens).
  const { data: assistantMessage } = await supabase
    .schema("chat")
    .from("messages")
    .insert({ conversation_id: id, role: "assistant", content: answer, metadata })
    .select("id")
    .single();

  // Requêtes SQL exécutées via mcp-trino : journalisées pour la facturation
  // et l'audit.
  const traces = (metadata.tool_calls as
    | { name: string; query?: string; ok: boolean }[]
    | undefined) ?? [];
  for (const trace of traces) {
    if (!trace.query) continue;
    await supabase.schema("lakehouse").from("query_history").insert({
      user_id: user.id,
      catalog_name: process.env.TRINO_DEFAULT_CATALOG_BINDING ?? "polaris",
      query: trace.query,
      status: trace.ok ? "success" : "error",
    });
  }

  // Titre généré par l'IA à partir des 2 premiers échanges.
  let newTitle: string | null = conversation.title;
  if (!conversation.title) {
    newTitle = await generateConversationTitle({
      model: agent.model_id || DEFAULT_MODEL,
      question: content,
      answer,
    });
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
