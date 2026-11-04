import path from "node:path";
import { defineConfig } from "vitest/config";

// Tests unitaires ParusDB (AGENTS.md §13) : node uniquement, pas de DOM - on
// cible la logique serveur (RBAC, crypto, backends LLM, registre de sources).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
