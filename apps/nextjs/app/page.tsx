import { getSessionContext } from "@/lib/session";
import { redirect } from "next/navigation";

// Racine : route protégée - redirection vers le chat (ou la connexion).
// La session (cookies) impose un rendu à la requête.
export const instant = false;

export default async function Page() {
  const session = await getSessionContext();
  redirect(session ? "/chat" : "/auth/login");
}
