// ESLint (#72): regras recomendadas do JavaScript e do typescript-eslint, com checagem de tipos.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: ["./tsconfig.json", "./tsconfig.test.json"], tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // node:test: describe() e it() devolvem promises que o runner acompanha sozinho, e os
    // dublês de teste são async só para imitar a interface real
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
);
