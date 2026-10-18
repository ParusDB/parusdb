"use client";

import { useMemo, useRef } from "react";

// Éditeur SQL avec coloration syntaxique (charte : code sur fond charbon,
// mots-clés en jaune), numérotation des lignes et onglets gérés par le parent.

const KEYWORDS = new Set([
  "select", "from", "where", "group", "by", "order", "having", "limit",
  "insert", "into", "values", "update", "set", "delete", "create", "drop",
  "alter", "table", "schema", "view", "catalog", "as", "on", "join", "left",
  "right", "inner", "outer", "full", "cross", "union", "all", "distinct",
  "and", "or", "not", "null", "is", "in", "like", "between", "case", "when",
  "then", "else", "end", "with", "asc", "desc", "count", "sum", "avg", "min",
  "max", "if", "exists", "partition", "over", "show", "describe", "use",
  "true", "false", "interval", "date", "timestamp", "cast", "coalesce",
  "truncate", "analyze", "explain", "format",
]);

type Token = { text: string; kind: "kw" | "str" | "num" | "com" | "id" | "op" };

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  const pattern =
    /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|("[^"]*")/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    if (match.index > last) {
      tokens.push({ text: sql.slice(last, match.index), kind: "op" });
    }
    if (match[1]) tokens.push({ text: match[1], kind: "com" });
    else if (match[2]) tokens.push({ text: match[2], kind: "str" });
    else if (match[3]) tokens.push({ text: match[3], kind: "num" });
    else if (match[4]) {
      const word = match[4];
      tokens.push({
        text: word,
        kind: KEYWORDS.has(word.toLowerCase()) ? "kw" : "id",
      });
    } else if (match[5]) tokens.push({ text: match[5], kind: "str" });
    last = pattern.lastIndex;
  }
  if (last < sql.length) {
    tokens.push({ text: sql.slice(last), kind: "op" });
  }
  return tokens;
}

const KIND_CLASS: Record<Token["kind"], string> = {
  kw: "text-jaune",
  str: "text-olive",
  num: "text-bleu",
  com: "text-blanc/40",
  id: "text-blanc/90",
  op: "text-blanc/70",
};

export function SqlEditor({
  value,
  onChange,
  onRun,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  disabled?: boolean;
}) {
  const tokens = useMemo(() => tokenize(value), [value]);
  const lineCount = value.split("\n").length;
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative flex h-72 overflow-hidden rounded-2xl border border-white/10 bg-charbon font-mono text-sm shadow-[0_30px_60px_-20px_rgba(26,26,26,0.5)]">
      {/* Gutter numérotation des lignes */}
      <div
        className="w-12 shrink-0 select-none overflow-hidden border-r border-white/10 bg-black/30 py-4 text-right text-blanc/40"
        aria-hidden
      >
        <div ref={gutterRef} className="px-2 leading-6">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
      </div>
      <div className="relative flex-1">
        <pre
          ref={preRef}
          className="pointer-events-none absolute inset-0 overflow-hidden p-4 leading-6 whitespace-pre-wrap"
          aria-hidden
        >
          <code>
            {tokens.map((token, i) => (
              <span key={i} className={KIND_CLASS[token.kind]}>
                {token.text}
              </span>
            ))}
            {"\n"}
          </code>
        </pre>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onRun?.();
            }
            if (e.key === "Tab") {
              e.preventDefault();
              const target = e.currentTarget;
              const start = target.selectionStart;
              onChange(`${value.slice(0, start)}  ${value.slice(target.selectionEnd)}`);
              requestAnimationFrame(() => {
                target.selectionStart = start + 2;
                target.selectionEnd = start + 2;
              });
            }
          }}
          spellCheck={false}
          disabled={disabled}
          aria-label="Éditeur SQL"
          className="absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent p-4 leading-6 whitespace-pre-wrap text-transparent caret-jaune outline-none selection:bg-jaune/30"
          onScroll={(e) => {
            const { scrollTop, scrollLeft } = e.currentTarget;
            if (preRef.current) {
              preRef.current.scrollTop = scrollTop;
              preRef.current.scrollLeft = scrollLeft;
            }
            if (gutterRef.current) {
              gutterRef.current.style.transform = `translateY(${-scrollTop}px)`;
            }
          }}
        />
      </div>
    </div>
  );
}
