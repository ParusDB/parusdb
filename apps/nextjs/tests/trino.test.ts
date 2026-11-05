import { describe, expect, it, vi } from "vitest";

// Découpage SQL multi-requêtes (lib/trino.ts) : le client Trino n'accepte
// qu'une requête par appel - l'éditeur sépare les requêtes manuellement,
// en respectant chaînes, identifiants quottés et commentaires.

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    throw new Error("non attendu dans ces tests");
  }),
}));

import { splitSqlStatements } from "@/lib/trino";

describe("splitSqlStatements", () => {
  it("sépare les requêtes et ignore les fragments vides", () => {
    expect(splitSqlStatements("SELECT 1; SELECT 2;; SELECT 3;")).toEqual([
      "SELECT 1",
      "SELECT 2",
      "SELECT 3",
    ]);
  });

  it("tolère le point-virgule terminal simple", () => {
    expect(splitSqlStatements("SELECT * FROM dev.customer.accounts;")).toEqual([
      "SELECT * FROM dev.customer.accounts",
    ]);
  });

  it("ne coupe pas sur un point-virgule dans une chaîne", () => {
    expect(
      splitSqlStatements("SELECT ';' AS sep, 'a''b' FROM t; SELECT 2"),
    ).toEqual(["SELECT ';' AS sep, 'a''b' FROM t", "SELECT 2"]);
  });

  it("ne coupe pas dans un identifiant quotté ni un commentaire", () => {
    const sql = 'SELECT 1 FROM "a;b" -- commentaire; ignoré\n UNION SELECT 2 /* bloc; */';
    expect(splitSqlStatements(sql)).toEqual([
      'SELECT 1 FROM "a;b" -- commentaire; ignoré\n UNION SELECT 2 /* bloc; */',
    ]);
  });

  it("retourne un tableau vide pour une saisie sans requête", () => {
    expect(splitSqlStatements("")).toEqual([]);
    expect(splitSqlStatements("  ; ;  ")).toEqual([]);
    expect(splitSqlStatements("-- juste un commentaire")).toEqual([]);
  });

  it("préserve les commentaires en tête de requête", () => {
    expect(
      splitSqlStatements("-- calcul du CA\nSELECT 1;\n-- suite\nSELECT 2"),
    ).toEqual(["-- calcul du CA\nSELECT 1", "-- suite\nSELECT 2"]);
  });
});
