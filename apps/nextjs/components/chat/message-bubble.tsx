"use client";

import { cn } from "@/lib/utils";

// Bulles de chat (charte §8.2) : utilisateur à droite sur fond muted, agent à
// gauche sur fond charbon, code SQL en jaune mono.

function CodeBlock({ language, code }: { language: string; code: string }) {
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-white/10 bg-black/40">
      <p className="mono border-b border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-blanc/50">
        {language || "code"}
      </p>
      <pre className="overflow-x-auto p-3">
        <code className="mono text-sm leading-relaxed text-jaune">{code}</code>
      </pre>
    </div>
  );
}

// Rendu minimaliste : blocs ```fenced``` + texte.
export function MessageContent({
  content,
  tone,
}: {
  content: string;
  tone: "user" | "assistant";
}) {
  const parts = content.split(/```/);
  return (
    <div
      className={cn(
        "space-y-1 text-sm leading-relaxed",
        tone === "assistant" && "text-blanc",
      )}
    >
      {parts.map((part, index) => {
        if (index % 2 === 1) {
          const newline = part.indexOf("\n");
          const language = newline > -1 ? part.slice(0, newline).trim() : "";
          const code = newline > -1 ? part.slice(newline + 1) : part;
          return (
            <CodeBlock key={index} language={language} code={code.replace(/\n$/, "")} />
          );
        }
        return part.trim() ? (
          <p key={index} className="whitespace-pre-wrap">
            {part}
          </p>
        ) : null;
      })}
    </div>
  );
}

export function MessageBubble({
  role,
  content,
}: {
  role: "user" | "assistant";
  content: string;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-tr-none bg-muted px-4 py-2.5 text-sm">
          <p className="whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-lg rounded-tl-none bg-charbon px-4 py-2.5 shadow-[0_30px_60px_-20px_rgba(26,26,26,0.5)]">
        <MessageContent content={content} tone="assistant" />
      </div>
    </div>
  );
}
