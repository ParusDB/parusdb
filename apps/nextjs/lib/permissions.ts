// Permissions applicatives ParusDB (RBAC, spec §Rôles et Permissions).
// Les clés vivent dans iam.roles.permissions (text[]) ; ce fichier est la
// source côté TypeScript pour l'UI (libellés et checklist d'édition).

export const PERMISSIONS = [
  { key: "chat", label: "Chat" },
  { key: "agents", label: "Agents IA" },
  { key: "lakehouse", label: "Data Lakehouse" },
  { key: "connectors", label: "Connecteurs" },
  { key: "admin.users", label: "Administration — Utilisateurs" },
  { key: "admin.roles", label: "Administration — Rôles" },
  { key: "admin.servers", label: "Administration — Serveurs locaux" },
  { key: "admin.billing", label: "Administration — Facturation" },
  { key: "support", label: "Support" },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

export function permissionLabel(key: string): string {
  return PERMISSIONS.find((p) => p.key === key)?.label ?? key;
}
