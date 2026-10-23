import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.USDT_OFFLINE_PORT ?? 3211);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid offline test port.");
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e", testMatch: "usdt-requests-offline.spec.ts", fullyParallel: false,
  workers: 1, retries: 0, timeout: 180_000, expect: { timeout: 30_000 }, reporter: "list",
  outputDir: "test-results/usdt-requests-offline",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure", headless: true, actionTimeout: 45_000 },
  webServer: {
    command: `node scripts/usdt-request-offline.mjs --port ${port} --no-seed${process.env.USDT_OFFLINE_PRODUCTION === "1" ? " --production" : ""}`,
    url: `${baseURL}/api/alpha-exchange/market-rate`, reuseExistingServer: false, timeout: 240_000,
    stdout: "pipe", stderr: "pipe",
  },
  projects: [{ name: "usdt-offline-chrome", use: { ...devices["Desktop Chrome"], channel: process.env.USDT_OFFLINE_BROWSER_CHANNEL ?? "chrome" } }],
});
