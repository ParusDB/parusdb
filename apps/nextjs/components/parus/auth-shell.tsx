
// Écrans d’authentification - « moment fort » de la marque (charte §6 et
// §9.4) : fond charbon, grille, halo jaune radial, carte en rounded-3xl.
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-svh overflow-hidden bg-charbon text-blanc">
      <div className="pointer-events-none absolute -top-40 right-0 h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,#FFD700_0%,transparent_60%)] opacity-30 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
      <div className="relative flex min-h-svh flex-col items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="rounded-3xl border border-white/10 bg-card p-8 text-foreground shadow-[0_30px_60px_-20px_rgba(0,0,0,0.8)]">
            <h1 className="font-display text-2xl">{title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            <div className="mt-6">{children}</div>
          </div>
          <p className="mono mt-6 text-center text-xs uppercase tracking-[0.2em] text-blanc/50">
            Fait en France · Données souveraines
          </p>
        </div>
      </div>
    </div>
  );
}
