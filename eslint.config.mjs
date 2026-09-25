import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Echte Lint-Konfiguration (ESLint Flat Config).
 * Der bisherige `lint`-Script war nur ein Typecheck-Alias und ist damit ersetzt.
 */
export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".bob-data/**",
      "out/**",
      "coverage/**",
      "next-env.d.ts"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module"
      }
    },
    rules: {
      // Sicherheitsrelevante Muster sichtbar machen.
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }
      ],
      "@typescript-eslint/consistent-type-imports": "off"
    }
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off"
    }
  }
);
