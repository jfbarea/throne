import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated coverage report (gitignored). `npm run test:coverage` is part
    // of the definition of done for the pure domain modules, so without this
    // every run leaves lint warnings on generated vendor scripts.
    "coverage/**",
    // Generated Prisma client.
    "src/generated/**",
  ]),
]);

export default eslintConfig;
