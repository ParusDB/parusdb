import Image from "next/image";
import { cn } from "@/lib/utils";

// Logo officiel ParusDB (public/parusdb-logo.jpg, fond blanc opaque,
// marges du fichier d'origine conservées telles quelles - l'asset n'est
// jamais retouché par le code). Le JPEG s'affiche en rectangle blanc sur
// les fonds charbon des zones d'accueil (sidebar, barre mobile, auth).
export function ParusLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/parusdb-logo.jpg"
      alt="ParusDB"
      width={1340}
      height={423}
      priority
      className={cn("h-9 w-auto", className)}
    />
  );
}
