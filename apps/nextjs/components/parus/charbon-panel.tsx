import { cn } from "@/lib/utils";

// États « moments forts » (charte §6) : charbon + grille + halo jaune radial.
export function CharbonPanel({
  children,
  className,
  size = "md",
}: {
  children: React.ReactNode;
  className?: string;
  size?: "md" | "lg";
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl bg-charbon text-blanc shadow-[0_30px_60px_-20px_rgba(26,26,26,0.5)]",
        size === "lg" ? "p-10 sm:p-16" : "p-8",
        className,
      )}
    >
      <div className="pointer-events-none absolute -top-40 right-0 h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,#FFD700_0%,transparent_60%)] opacity-30 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
      <div className="relative">{children}</div>
    </div>
  );
}
