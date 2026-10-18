// Page dynamique : la session (cookies) impose un rendu à la requête.
export const instant = false;

import { notFound } from "next/navigation";
import { CatalogWorkspace } from "@/components/lakehouse/catalog-workspace";
import { requirePermission } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { trinoBindingFor, loadCatalogTree } from "@/lib/lakehouse";
import type { CatalogEntry } from "@/types/db";

export default async function CatalogPage({
  params,
}: {
  params: Promise<{ catalog: string }>;
}) {
  await requirePermission("lakehouse");
  const { catalog } = await params;
  const supabase = await createClient();

  const { data: entry } = await supabase
    .schema("lakehouse")
    .from("catalog_registry")
    .select("catalog_name, description, created_by, created_at, updated_at")
    .eq("catalog_name", catalog)
    .maybeSingle();

  const binding = trinoBindingFor(catalog);

  let tree = null;
  let treeError: string | null = null;
  if (binding) {
    try {
      tree = await loadCatalogTree(binding);
    } catch (error) {
      treeError =
        error instanceof Error ? error.message : "Trino est injoignable.";
    }
  }

  if (!entry && !binding) {
    // Catalogue absent du registre et non lié : probablement inexistant.
    notFound();
  }

  const row = entry as unknown as CatalogEntry | null;

  return (
    <CatalogWorkspace
      catalog={catalog}
      description={row?.description ?? null}
      binding={binding}
      tree={tree}
      treeError={treeError}
    />
  );
}
