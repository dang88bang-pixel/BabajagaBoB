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
    // Persistenz-Tests laufen isoliert, damit Storen sich nicht vermischen.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: false }
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ["default"]
  }
});
