import {defineConfig} from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./")
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globals: false,
    // Persistenz-Tests laufen isoliert (ein eigener Fork je Datei, damit sich
    // Storen nicht vermischen). Ab Vitest 5 ist `poolOptions` entfallen; der
    // Standard ist bereits ein Prozess je Testdatei, deshalb steht hier nur der Pool.
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ["default"]
  }
});
