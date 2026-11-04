import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionContext } from "@/lib/session";
import type { Grant } from "@/types/db";

// Helpers RBAC purs (lib/rbac.ts) : le calcul applicatif `can` doit refléter
// iam.has_grant côté SQL - hiérarchie read < write < manage, propriété par
// rôle, admin qui hérite de tout (spec § Rôles et Permissions).

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    throw new Error("non attendu dans ces tests");
  }),
}));

import { can } from "@/lib/rbac";

const ROLE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ROLE_ID = "22222222-2222-4222-8222-222222222222";

function session(isAdmin = false, roleId: string | null = ROLE_ID) {
  return {
    userId: "00000000-0000-4000-8000-000000000000",
    email: "user@test.local",
    profile: null,
    roles: [],
    activeRole: roleId
      ? ({ id: roleId, key: "sales", name: "Sales" } as never)
      : null,
    isAdmin,
  } satisfies SessionContext;
}

function grant(privileges: Grant["privileges"]): Grant {
  return {
    role_id: ROLE_ID,
    resource_type: "catalog",
    resource_id: "dev",
    privileges,
  } as Grant;
}

beforeEach(() => {
  vi.resetModules();
});

describe("can (capacités RBAC)", () => {
  it("admin hérite de tout, quel que soit le privilège", () => {
    expect(can(session(true), [], "catalog", "dev", null, "manage")).toBe(true);
  });

  it("sans rôle actif et non admin : aucun accès", () => {
    expect(can(session(false, null), [], "catalog", "dev", null, "read")).toBe(
      false,
    );
  });

  it("le propriétaire du rôle de l'objet a tous les privilèges", () => {
    expect(can(session(), [], "catalog", "dev", ROLE_ID, "manage")).toBe(true);
    expect(can(session(), [], "catalog", "dev", OTHER_ROLE_ID, "read")).toBe(
      false,
    );
  });

  it("les grants sont hiérarchiques (manage couvre write couvre read)", () => {
    const grants = [grant(["manage"])];
    expect(can(session(), grants, "catalog", "dev", null, "read")).toBe(true);
    expect(can(session(), grants, "catalog", "dev", null, "write")).toBe(true);
    expect(can(session(), grants, "catalog", "dev", null, "manage")).toBe(true);
  });

  it("un grant read ne confère jamais write ni manage", () => {
    const grants = [grant(["read"])];
    expect(can(session(), grants, "catalog", "dev", null, "read")).toBe(true);
    expect(can(session(), grants, "catalog", "dev", null, "write")).toBe(false);
    expect(
      can(session(), grants, "catalog", "dev", null, "manage"),
    ).toBe(false);
  });

  it("un grant ne s'applique qu'à sa ressource", () => {
    const grants = [grant(["read"])];
    expect(can(session(), grants, "catalog", "prod", null, "read")).toBe(false);
    expect(can(session(), grants, "agent", "dev", null, "read")).toBe(false);
  });
});
