"use client";

import { isValidElement, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

// Bulles de chat (charte §8.2) : utilisateur à droite sur fond muted, agent à
// gauche sur fond charbon. Le contenu de l'agent est du markdown rendu via
// react-markdown (titres, listes, gras, code inline, tableaux), les blocs de
// code sont colorés syntaxiquement (highlight.js via rehype-highlight) et
// passent à la ligne - pas de défilement horizontal dans la bulle.

// Texte brut d'un bloc fenced depuis l'élément code enfant (pour le bouton
// « Copier ») - traverse les spans de coloration éventuels.
function codeText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) return children.map(codeText).join("");
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return codeText(children.props.children);
  }
  return "";
}

function CodeBlock({
  language,
  code,
  highlighted,
  children,
}: {
  language: string;
  code: string;
  /** Le bloc a été coloré par highlight.js : texte de base neutre, les
   * tokens portent les classes .hljs-*. Sinon, code brut en jaune (charte). */
  highlighted: boolean;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard indisponible (contexte non sécurisé) : copie ignorée.
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-white/10 bg-black/40">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-1">
        <span className="mono text-[10px] uppercase tracking-[0.2em] text-blanc/50">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={copyCode}
          className="mono inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-blanc/50 transition-colors hover:text-jaune"
          aria-label="Copier le code"
        >
          {copied ? (
            <Check className="h-3 w-3" strokeWidth={1.8} />
          ) : (
            <Copy className="h-3 w-3" strokeWidth={1.8} />
          )}
          {copied ? "Copié" : "Copier"}
        </button>
      </div>
      <pre className="p-3">
        <code
          className={cn(
            "mono block whitespace-pre-wrap break-words text-sm leading-relaxed",
            highlighted ? "text-blanc/90" : "text-jaune",
          )}
        >
          {children}
        </code>
      </pre>
    </div>
  );
}

// Mappings markdown → charte, dans le contexte de la bulle agent (texte blanc
// sur fond charbon). Rayons et couleurs restent ceux des tokens de marque.
const assistantComponents: Components = {
  pre({ children }) {
    const child = Array.isArray(children) ? children[0] : children;
    if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
      const className = child.props.className ?? "";
      const language = /language-([\w-]+)/.exec(className)?.[1] ?? "";
      return (
        <CodeBlock
          language={language}
          code={codeText(child.props.children)}
          highlighted={className.includes("hljs")}
        >
          {child.props.children}
        </CodeBlock>
      );
    }
    return <pre>{children}</pre>;
  },
  code({ className, children }) {
    // Code inline (les blocs fenced sont captés par `pre` ci-dessus).
    return (
      <code
        className={cn(
          "mono break-words rounded bg-white/10 px-1 py-0.5 text-[0.85em] text-jaune",
          className,
        )}
      >
        {children}
      </code>
    );
  },
  p({ children }) {
    return <p className="mb-2 last:mb-0">{children}</p>;
  },
  h1({ children }) {
    return <h1 className="mb-2 mt-3 font-display text-lg text-blanc">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="mb-2 mt-3 font-display text-base text-blanc">{children}</h2>;
  },
  h3({ children }) {
    return (
      <h3 className="mb-1 mt-3 font-display text-sm font-semibold text-blanc">
        {children}
      </h3>
    );
  },
  h4({ children }) {
    return (
      <h4 className="mb-1 mt-2 font-display text-sm font-semibold text-blanc">
        {children}
      </h4>
    );
  },
  ul({ children }) {
    return (
      <ul className="mb-2 list-disc space-y-1 pl-5 marker:text-blanc/50">
        {children}
      </ul>
    );
  },
  ol({ children }) {
    return (
      <ol className="mb-2 list-decimal space-y-1 pl-5 marker:text-blanc/50">
        {children}
      </ol>
    );
  },
  li({ children }) {
    return <li className="leading-relaxed">{children}</li>;
  },
  strong({ children }) {
    return <strong className="font-semibold text-blanc">{children}</strong>;
  },
  a({ children, href }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-jaune underline underline-offset-2 hover:text-jaune/80"
      >
        {children}
      </a>
    );
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-2 border-l-2 border-jaune/60 pl-3 text-blanc/80 italic">
        {children}
      </blockquote>
    );
  },
  hr() {
    return <hr className="my-3 border-white/10" />;
  },
  table({ children }) {
    return (
      <div className="my-2 overflow-x-auto">
        <table className="w-full border-collapse text-left">{children}</table>
      </div>
    );
  },
  th({ children }) {
    return (
      <th className="mono border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.15em] text-blanc/70">
        {children}
      </th>
    );
  },
  td({ children }) {
    return <td className="border border-white/10 px-2 py-1">{children}</td>;
  },
};

// Rendu markdown des réponses de l'agent (remark-gfm : tableaux, listes de
// tâches, barré ; rehype-highlight : coloration syntaxique des blocs). Utilisé
// pour les messages persistés et le flux en cours.
export function MessageContent({
  content,
  tone,
}: {
  content: string;
  tone: "user" | "assistant";
}) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed",
        tone === "assistant" && "text-blanc",
      )}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeHighlight, { detect: false, ignoreMissing: true }],
        ]}
        components={tone === "assistant" ? assistantComponents : undefined}
      >
        {content}
      </Markdown>
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
