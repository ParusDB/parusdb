import Image from "next/image";
import { cn } from "@/lib/utils";

// Logo officiel ParusDB (public/parusdb-logo.jpg, fond blanc opaque,
// marges rognées). Le JPEG s'affiche en rectangle blanc sur les fonds
// charbon des zones d'accueil (sidebar, barre mobile, auth).
export function ParusLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/parusdb-logo.jpg"
      alt="ParusDB"
      width={1224}
      height={398}
      priority
      className={cn("h-9 w-auto", className)}
    />
  );
}
