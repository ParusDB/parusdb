import { cn } from "@/lib/utils";

// Point de statut — « feu jaune » pour l’actif (charte §10), cendre pour
// l’inactif, framboise pour l’erreur. Les runs ELT ajoutent « en file »
// (cendre) et « en cours » (jaune).
export function StatusDot({
  tone,
  className,
}: {
  tone: "active" | "inactive" | "error" | "queued" | "running";
  className?: string;
}) {
  if (tone === "active" || tone === "running") {
    return (
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full bg-jaune shadow-[0_0_10px_#FFD700]",
          className,
        )}
      />
    );
  }
  if (tone === "error") {
    return (
      <span
        className={cn("inline-block h-1.5 w-1.5 rounded-full bg-destructive", className)}
      />
    );
  }
  return (
    <span
      className={cn("inline-block h-1.5 w-1.5 rounded-full bg-cendre/60", className)}
    />
  );
}

export function StatusBadge({
  tone,
  label,
}: {
  tone: "active" | "inactive" | "error" | "queued" | "running";
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-muted-foreground">
      <StatusDot tone={tone} />
      {label}
    </span>
  );
}
