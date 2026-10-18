// Formatage français (dates, tailles, durées).

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} o`;
  const go = bytes / 1024 ** 3;
  if (go >= 1) return `${go.toFixed(2)} Go`;
  const mo = bytes / 1024 ** 2;
  if (mo >= 1) return `${mo.toFixed(1)} Mo`;
  return `${(bytes / 1024).toFixed(1)} Ko`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const min = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${min} min ${s} s`;
}

export function initials(
  first: string | null | undefined,
  last: string | null | undefined,
  email: string,
): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (f || l) return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

export function displayName(
  first: string | null | undefined,
  last: string | null | undefined,
  email: string,
): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (f || l) return [f, l].filter(Boolean).join(" ");
  return email;
}
