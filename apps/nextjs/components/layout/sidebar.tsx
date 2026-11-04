"use client";

import { useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  Bot,
  ChevronDown,
  Database,
  Info,
  LogOut,
  MessageSquare,
  Plug,
  Shield,
  Sun,
  Moon,
  Laptop,
  UserRound,
  KeyRound,
  List,
  PanelLeft,
} from "lucide-react";
import { ParusLogo } from "@/components/parus/logo";
import { SidebarListItem } from "@/components/layout/sidebar-list-item";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { signOut, switchActiveRole } from "@/app/(app)/actions";
import {
  deleteConversation,
  renameConversation,
} from "@/app/(app)/chat/actions";
import { deleteAgent, renameAgent } from "@/app/(app)/agents/actions";

export interface SidebarConversation {
  id: string;
  title: string | null;
  // Propriétaire de la conversation (les partages sont en lecture seule).
  owned: boolean;
}

export interface SidebarAgent {
  id: string;
  name: string;
  // Privilèges du rôle actif : renommer (write) / supprimer (manage).
  canRename: boolean;
  canDelete: boolean;
}

export interface SidebarProps {
  user: { email: string; firstName: string | null; lastName: string | null };
  roles: { id: string; name: string }[];
  activeRoleId: string | null;
  // Le compte porte le rôle admin : section Administration (RBAC refonte).
  isAdmin: boolean;
  conversations: SidebarConversation[];
  agents: SidebarAgent[];
}

function initialsOf(first: string | null, last: string | null, email: string) {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (f || l) return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

function displayNameOf(
  first: string | null,
  last: string | null,
  email: string,
) {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (f || l) return [f, l].filter(Boolean).join(" ");
  return email;
}

// Hydratation : vrai côté client après hydratation, faux pendant le rendu
// serveur - sans setState dans un effet.
function useIsHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

// Zone utilisateur (bas gauche) : identité, thème, rôle actif, déconnexion.
function UserZone({ session }: { session: SidebarProps }) {
  const { theme, setTheme } = useTheme();
  const mounted = useIsHydrated();
  const activeRole =
    session.roles.find((r) => r.id === session.activeRoleId) ?? null;
  const themeIcon =
    theme === "dark" ? <Moon className="h-4 w-4" /> : theme === "light" ? <Sun className="h-4 w-4" /> : <Laptop className="h-4 w-4" />;

  return (
    <div className="border-t border-white/10 p-3">
      <div className="flex items-center gap-2.5">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-jaune text-xs font-semibold text-charbon">
          {initialsOf(session.user.firstName, session.user.lastName, session.user.email)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-blanc">
            {displayNameOf(session.user.firstName, session.user.lastName, session.user.email)}
          </p>
          <p className="truncate text-xs text-blanc/50">{session.user.email}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-blanc/70 hover:bg-white/5 hover:text-jaune"
          aria-label="Se déconnecter"
          title="Se déconnecter"
          onClick={() => void signOut()}
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        {mounted ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-blanc/70 hover:bg-white/5 hover:text-jaune"
                aria-label="Changer de thème"
              >
                {themeIcon}
                <span className="mono text-[11px] uppercase">
                  {theme === "system" ? "Système" : theme === "dark" ? "Sombre" : "Clair"}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onClick={() => setTheme("light")}>
                <Sun className="h-4 w-4" /> Clair
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                <Moon className="h-4 w-4" /> Sombre
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>
                <Laptop className="h-4 w-4" /> Système
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {session.roles.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-blanc/70 hover:bg-white/5 hover:text-jaune"
                aria-label="Changer de rôle actif"
              >
                <Shield className="h-3.5 w-3.5" />
                <span className="mono truncate text-[11px] uppercase">
                  {activeRole?.name ?? "Aucun rôle"}
                </span>
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              {session.roles.map((role) => (
                <DropdownMenuItem
                  key={role.id}
                  onClick={() => void switchActiveRole(role.id)}
                  className={cn(
                    role.id === session.activeRoleId && "font-semibold text-olive",
                  )}
                >
                  {role.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}

function NavLink({
  href,
  icon,
  label,
  exact = false,
  className,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  exact?: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-white/5 text-jaune"
          : "text-blanc/70 hover:bg-white/5 hover:text-blanc",
        className,
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </Link>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mono px-3 pt-4 pb-1 text-[10px] uppercase tracking-[0.2em] text-blanc/40">
      {children}
    </p>
  );
}

// Contenu de navigation - partagé entre la sidebar fixe et le menu mobile.
// Tous les menus fonctionnels sont visibles par les comptes authentifiés
// (RBAC refonte) : le contenu est filtré par le rôle actif via la RLS.
// La section Administration n'apparaît que pour les comptes admin.
export function SidebarContent({ session }: { session: SidebarProps }) {
  const adminItems = [
    { href: "/admin/informations", label: "Informations", icon: <Info className="h-4 w-4" strokeWidth={1.6} /> },
    { href: "/admin/users", label: "Utilisateurs", icon: <UserRound className="h-4 w-4" strokeWidth={1.6} /> },
    { href: "/admin/roles", label: "Rôles", icon: <Shield className="h-4 w-4" strokeWidth={1.6} /> },
    { href: "/admin/providers", label: "Fournisseurs LLM", icon: <KeyRound className="h-4 w-4" strokeWidth={1.6} /> },
  ];

  return (
    <div className="flex h-full flex-col">
      <Link href="/chat" aria-label="ParusDB - accueil" className="block">
        <ParusLogo className="h-auto w-full" />
      </Link>

      <nav className="flex-1 overflow-y-auto px-2 pb-4 pt-5">
        <div>
            <SectionLabel>Conversations</SectionLabel>
            <NavLink
              href="/chat"
              icon={<List className="h-4 w-4" strokeWidth={1.6} />}
              label="Liste des chats"
              exact
            />
            {session.conversations.length > 0 ? (
              <div className="space-y-0.5">
                  {session.conversations.map((c) => {
                    const label = c.title ?? `Chat ${c.id.slice(0, 8)}`;
                    return (
                      <SidebarListItem
                        key={c.id}
                        label={label}
                        href={`/chat/${c.id}`}
                        onRename={
                          c.owned
                            ? async (title) => {
                                await renameConversation(c.id, title);
                              }
                            : undefined
                        }
                        onDelete={
                          c.owned
                            ? () => deleteConversation(c.id)
                            : undefined
                        }
                        deleteTitle="Supprimer cette conversation ?"
                        deleteDescription={`« ${label} » et son historique seront supprimés définitivement.`}
                      >
                        <NavLink
                          href={`/chat/${c.id}`}
                          icon={<MessageSquare className="h-4 w-4" strokeWidth={1.6} />}
                          label={label}
                          exact
                          className="py-1.5 text-[13px]"
                        />
                      </SidebarListItem>
                    );
                  })}
                </div>
            ) : null}
        </div>

        <SectionLabel>Agents IA</SectionLabel>
        <NavLink
          href="/agents"
          icon={<List className="h-4 w-4" strokeWidth={1.6} />}
          label="Liste des agents"
          exact
        />
        <div className="space-y-0.5">
          {session.agents.map((a) => (
            <SidebarListItem
              key={a.id}
              label={a.name}
              href={`/agents/${a.id}`}
              onRename={
                a.canRename
                  ? async (name) => {
                      await renameAgent(a.id, name);
                    }
                  : undefined
              }
              onDelete={a.canDelete ? () => deleteAgent(a.id) : undefined}
              deleteRequiresName
              deleteTitle="Supprimer cet agent ?"
              deleteDescription={`Toutes les sources associées à « ${a.name} » seront détachées. Les conversations existantes sont conservées et l'agent ne pourra plus être supprimé tant qu'elles y font référence.`}
            >
              <NavLink
                href={`/agents/${a.id}`}
                icon={<Bot className="h-4 w-4" strokeWidth={1.6} />}
                label={a.name}
                className="py-1.5 text-[13px]"
              />
            </SidebarListItem>
          ))}
        </div>

        <SectionLabel>Données</SectionLabel>
        <NavLink href="/data-lakehouse" icon={<Database className="h-4 w-4" strokeWidth={1.6} />} label="Data Lakehouse" exact />
        <NavLink href="/connectors" icon={<Plug className="h-4 w-4" strokeWidth={1.6} />} label="Connecteurs" exact />

        {session.isAdmin ? (
          <>
            <SectionLabel>Administration</SectionLabel>
            <div className="space-y-0.5">
              {adminItems.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  className="py-1.5 text-[13px]"
                />
              ))}
            </div>
          </>
        ) : null}
      </nav>

      <UserZone session={session} />
    </div>
  );
}

export function Sidebar({ session }: { session: SidebarProps }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Barre mobile */}
      <div className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-charbon px-4 lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-blanc hover:bg-white/5 hover:text-jaune"
              aria-label="Ouvrir le menu"
            >
              <PanelLeft className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-72 border-white/10 bg-charbon p-0 text-blanc"
            onClick={() => setOpen(false)}
          >
            <SidebarContent session={session} />
          </SheetContent>
        </Sheet>
        <Link href="/chat" aria-label="ParusDB - accueil">
          <ParusLogo className="h-10 w-auto" />
        </Link>
      </div>

      {/* Sidebar fixe (desktop) */}
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 bg-charbon lg:block">
        <SidebarContent session={session} />
      </aside>
    </>
  );
}
