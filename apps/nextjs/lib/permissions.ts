// Métadonnées du RBAC applicatif (refonte, docs/functional/rbac_refonte.md).
// Les accès ne sont plus des permissions statiques de menu : ce fichier est
// la source TypeScript des types de ressources et des privilèges hiérarchiques
// (manage ⊇ write ⊇ read) affichés dans l'éditeur de rôles (/admin/roles).

export const RESOURCE_TYPES = [
  { key: "catalog", label: "Catalogues" },
  { key: "agent", label: "Agents IA" },
  { key: "pipeline", label: "Pipelines" },
] as const;

export const PRIVILEGES = [
  { key: "read", label: "Lecture" },
  { key: "write", label: "Écriture" },
  { key: "manage", label: "Gestion" },
] as const;

export type ResourceKey = (typeof RESOURCE_TYPES)[number]["key"];
export type PrivilegeKey = (typeof PRIVILEGES)[number]["key"];

export function resourceLabel(key: string): string {
  return RESOURCE_TYPES.find((r) => r.key === key)?.label ?? key;
}

export function privilegeLabel(key: string): string {
  return PRIVILEGES.find((p) => p.key === key)?.label ?? key;
}
