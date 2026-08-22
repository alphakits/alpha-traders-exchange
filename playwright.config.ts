import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL, E2E_PORT } from "./e2e/support/base-url";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
    headless: true,
  },
  webServer: {
    command: `npm run clean && npm run build && npm run start -- -H 127.0.0.1 -p ${E2E_PORT}`,
    url: E2E_BASE_URL,
    reuseExistingServer: false,
    timeout: 600_000,
    env: {
      ...process.env,
      NODE_ENV: "production",
      // Explicit local-only marker for production-mode E2E. Runtime guards
      // reject all test support in deployed Vercel environments. The server
      // also binds to loopback so test-only routes cannot be reached remotely.
      ALPHA_E2E_TEST_SUPPORT: "1",
      ALPHA_E2E_LOOPBACK_ONLY: "1",
      ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY: "1",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
