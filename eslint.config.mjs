import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".next-dev/**",
      ".next-runtime/**",
      ".next-runtime-build/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "e2e/**",
      "tmp-*.js",
      "tmp-*.mjs",
      "tmp-*.ts",
      "tmp/**",
      "archives/**",
      ".preserved-task2-clean/**",
    ],
  },
];

export default eslintConfig;
