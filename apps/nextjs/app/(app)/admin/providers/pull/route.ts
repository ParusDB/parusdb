import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/session";
import { listModels, pullModel, validateModelName } from "@/lib/ollama";

// Téléchargement d'un modèle Ollama (spec §Fournisseurs LLM). Le téléchargement
// peut durer plusieurs minutes : le BFF relaie le flux NDJSON progressif
// d'Ollama vers le navigateur (évènements simplifiés, un par ligne) au lieu
// d'attendre la fin - même pattern BFF que le stream du chat.
//
// Lignes émises vers le client :
//   {"type":"log","message":"…"}                       (chaque ligne Ollama)
//   {"type":"progress","digest":"sha256:…","total":N,"completed":N}
//   {"type":"success"}
//   {"type":"error","message":"…"}

interface PullLine {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

interface ClientEvent {
  type: "log" | "progress" | "success" | "error";
  message?: string;
  digest?: string;
  total?: number;
  completed?: number;
}

// Chaque ligne Ollama devient au plus un évènement de log (statut brut, temps
// réel) plus, pour les couches, un évènement de progression. Le libellé du
// statut d'une couche varie selon la version d'Ollama (« pulling <digest> »,
// « downloading <digest> ») : la progression se reconnaît à la présence du
// champ digest, pas au libellé.
function translatePullEvent(line: PullLine): ClientEvent[] {
  if (line.error) {
    return [
      { type: "log", message: line.error },
      { type: "error", message: translateOllamaError(line.error) },
    ];
  }
  if (line.digest) {
    const completed = line.completed ?? 0;
    const total = line.total ?? 0;
    const percent = total > 0 ? Math.round((completed / total) * 100) : null;
    return [
      {
        type: "log",
        message: `${line.status ?? "pulling"}${
          percent !== null ? ` : ${percent} %` : ""
        }`,
      },
      { type: "progress", digest: line.digest, total, completed },
    ];
  }
  if (line.status === "success") {
    return [{ type: "log", message: line.status }, { type: "success" }];
  }
  return [{ type: "log", message: line.status ?? "" }];
}

// Messages d'Ollama reformulés pour rester actionnables côté interface.
function translateOllamaError(raw: string): string {
  const message = raw.trim();
  if (/file does not exist|manifest unknown|repository does not exist/i.test(message)) {
    return "Modèle introuvable dans le registre : vérifiez le nom exact sur ollama.com (ex. « gemma3:4b »).";
  }
  if (/unauthorized|authentication/i.test(message)) {
    return "Le registre a refusé le téléchargement : nom de modèle privé ou inexistant.";
  }
  if (/timeout|connection|dial/i.test(message)) {
    return "Le registre est injoignable : vérifiez la connexion réseau du serveur Ollama.";
  }
  return `Le téléchargement a échoué : ${message}`;
}

export async function POST(request: Request) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json(
      { error: "Rôle administrateur requis." },
      { status: 403 },
    );
  }

  let rawModel = "";
  try {
    const body = (await request.json()) as { model?: string };
    rawModel = (body.model ?? "").trim();
  } catch {
    return NextResponse.json(
      { error: "Corps de requête invalide." },
      { status: 400 },
    );
  }
  const model = validateModelName(rawModel);
  if (!model) {
    return NextResponse.json(
      {
        error:
          "Nom de modèle invalide (attendu : le nom publié sur ollama.com, ex. « gemma3:4b »).",
      },
      { status: 400 },
    );
  }

  // Ollama doit être joignable et le modèle ne doit pas déjà être installé
  // (un pull sur un modèle existant est une mise à jour implicite - hors
  // périmètre de ce parcours).
  try {
    const installed = await listModels();
    if (installed.some((m) => m.name === model)) {
      return NextResponse.json(
        { error: `Le modèle « ${model} » est déjà installé sur le serveur Ollama.` },
        { status: 409 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Ollama est injoignable : vérifiez que le service tourne (cd apps/ollama && sh run.sh start).",
      },
      { status: 502 },
    );
  }

  let upstream: Response;
  try {
    upstream = await pullModel(model);
  } catch {
    return NextResponse.json(
      { error: "Ollama est injoignable : le lancement du téléchargement a échoué." },
      { status: 502 },
    );
  }
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    let message = `Ollama /api/pull a échoué (HTTP ${upstream.status}).`;
    try {
      const parsed = JSON.parse(text) as PullLine;
      if (parsed.error) message = translateOllamaError(parsed.error);
    } catch {
      // corps non JSON : message générique
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const upstreamBody = upstream.body;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstreamBody.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            let parsed: PullLine;
            try {
              parsed = JSON.parse(line) as PullLine;
            } catch {
              continue;
            }
            const events = translatePullEvent(parsed);
            for (const event of events) {
              controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
            }
            if (events.some((event) => event.type === "error")) {
              await reader.cancel().catch(() => {});
              return;
            }
          }
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      void upstreamBody.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
