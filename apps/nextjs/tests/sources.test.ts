import { describe, expect, it } from "vitest";
import {
  findSource,
  requiresManualTables,
  SOURCES,
  type SourceDefinition,
} from "@/lib/sources";

// Registre des sources ELT consommé par le wizard de création de connecteurs :
// il doit rester cohérent avec le runner dlt (apps/dlt/runner/sources.py :
// kinds sql/endpoints/globs/resources/resource). Régression = wizard cassé.

describe("registre SOURCES", () => {
  it("n'a pas de clé dupliquée", () => {
    const keys = SOURCES.map((s: SourceDefinition) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("n'expose que les kinds connus du runner", () => {
    const allowed = new Set(["sql", "endpoints", "globs", "resources", "resource"]);
    for (const source of SOURCES) {
      expect(allowed.has(source.kind), source.key).toBe(true);
    }
  });

  it("declare chaque champ requis avec un libellé au minimum", () => {
    for (const source of SOURCES) {
      expect(source.key, "key").toBeTruthy();
      expect(source.label, `${source.key} label`).toBeTruthy();
      expect(source.category, `${source.key} category`).toBeTruthy();
      expect(source.group, `${source.key} group`).toBeTruthy();
      for (const field of source.fields) {
        expect(field.key, `${source.key}.${field.key}`).toBeTruthy();
        expect(field.label, `${source.key}.${field.key}`).toBeTruthy();
      }
    }
  });

  it("les sources SQL gardent les clés de credentials attendues par le runner", () => {
    const pg = findSource("postgresql");
    expect(pg?.kind).toBe("sql");
    expect(pg?.fields.map((f) => f.key)).toEqual(
      expect.arrayContaining(["host", "port", "database", "username", "password"]),
    );

    const kafka = findSource("kafka");
    expect(kafka?.kind).toBe("resource");
    expect(kafka?.fields.map((f) => f.key)).toEqual(
      expect.arrayContaining([
        "bootstrap_servers",
        "group_id",
        "security_protocol",
      ]),
    );
  });
});

describe("findSource / requiresManualTables", () => {
  it("trouve une source par clé et ne renvoie rien d'inconnu", () => {
    expect(findSource("postgresql")?.key).toBe("postgresql");
    expect(findSource("kafka")?.key).toBe("kafka");
    expect(findSource("inconnu")).toBeUndefined();
  });

  it("n'exigent la saisie manuelle des tables que pour endpoints/globs", () => {
    for (const source of SOURCES) {
      if (source.kind === "endpoints" || source.kind === "globs") {
        expect(requiresManualTables(source), source.key).toBe(true);
      } else {
        expect(requiresManualTables(source), source.key).toBe(false);
      }
    }
  });
});
