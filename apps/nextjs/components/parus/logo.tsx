import { Bird } from "lucide-react";
import { cn } from "@/lib/utils";

// Wordmark ParusDB : pastille jaune + nom en Space Grotesk (charte §10 :
// pas d’emoji, icônes lucide uniquement).
export function ParusLogo({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-jaune text-charbon">
        <Bird className="h-5 w-5" strokeWidth={1.8} />
      </span>
      {!compact ? (
        <span className="font-display text-lg font-semibold tracking-tight">
          Parus<span className="text-jaune">DB</span>
        </span>
      ) : null}
    </span>
  );
}
