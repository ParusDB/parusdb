import { describe, expect, it, vi } from "vitest";

// Filtrage RBAC des outils MCP (lib/agent-runner.ts) : le LLM ne doit voir
// et interroger que les catalogues accessibles au rôle actif de
// l'utilisateur - le compte de service mcp-trino verrait toute l'installation.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    throw new Error("non attendu dans ces tests");
  }),
}));

import {
  deniedToolCatalog,
  extractSqlCatalogs,
  rbacSystemPrompt,
} from "@/lib/agent-runner";

describe("extractSqlCatalogs", () => {
  it("extrait les catalogues des noms 3-parties après FROM/JOIN", () => {
    const sql =
      "SELECT * FROM dev.test.data d JOIN parusdb.sales.orders o ON d.id = o.id";
    expect(extractSqlCatalogs(sql)).toEqual(["dev", "parusdb"]);
  });

  it("ne remonte pas les noms 2-parties ni les alias sans point", () => {
    const sql = "SELECT * FROM information_schema.tables";
    expect(extractSqlCatalogs(sql)).toEqual([]);
  });

  it("parse aussi les identifiants quottés (sinon contournement)", () => {
    const sql = 'SELECT * FROM "parusdb"."x"."y"';
    expect(extractSqlCatalogs(sql)).toEqual(["parusdb"]);
  });

  it("est insensible à la casse", () => {
    expect(extractSqlCatalogs("select 1 from DEV.test.data")).toEqual(["dev"]);
  });
});

describe("deniedToolCatalog", () => {
  const allowed = ["dev"];

  it("refuse un catalogue non autorisé en argument", () => {
    expect(
      deniedToolCatalog("list_schemas", { catalog: "parusdb" }, allowed),
    ).toBe("parusdb");
    expect(
      deniedToolCatalog("list_tables", { catalog: "Dev" }, allowed),
    ).toBeNull();
  });

  it("refuse un catalogue non autorisé référencé dans le SQL", () => {
    expect(
      deniedToolCatalog("execute_query", { query: "SELECT 1 FROM prod.a.b" }, allowed),
    ).toBe("prod");
    expect(
      deniedToolCatalog("execute_query", { query: 'SELECT 1 FROM "prod"."a"."b"' }, allowed),
    ).toBe("prod");
  });

  it("autorise les noms 2-parties (schéma.table, sans catalogue)", () => {
    expect(
      deniedToolCatalog("execute_query", { query: "SELECT 1 FROM a.b" }, allowed),
    ).toBeNull();
  });

  it("liste_catalogs n'est pas filtré ici (résultat synthétisé en amont)", () => {
    expect(deniedToolCatalog("list_catalogs", {}, allowed)).toBeNull();
  });
});

describe("rbacSystemPrompt", () => {
  it("cite les catalogues autorisés et l'interdiction des autres", () => {
    const prompt = rbacSystemPrompt(["dev"]);
    expect(prompt).toContain("dev");
    expect(prompt).toContain("N'utilise et ne cite que ces catalogues");
  });
});
