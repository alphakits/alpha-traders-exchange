import { defineConfig } from "@playwright/test";

// Read-only public-page smoke checks; no seeded accounts or test-only APIs.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "native-market-recovery.spec.ts",
  workers: 2,
  timeout: 60_000,
  reporter: "list",
  use: { baseURL: process.env.E2E_CHART_BASE_URL ?? "http://127.0.0.1:3000", headless: true },
});
