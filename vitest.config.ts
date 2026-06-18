import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    // Pure Node — the judge and rubric logic have no DOM dependency.
    environment: "node",
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"],
    // Live eval (real OpenRouter / Postgres) is a separate `pnpm test:eval`
    // script, never the Vitest unit suite — keep CI deterministic and free.
    exclude: ["node_modules/**", ".next/**"],
  },
});
