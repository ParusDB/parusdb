import { cn } from "@/lib/utils";

// En-tête de page : eyebrow mono (marqueur de marque, charte §4.2) + titre
// Space Grotesk + description.
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div>
        <p className="mono text-xs uppercase tracking-[0.2em] text-olive">
          {eyebrow}
        </p>
        <h1 className="mt-2 font-display text-3xl text-balance">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
