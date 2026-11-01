import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.WISE_OFFLINE_PORT ?? 3227);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid Wise offline test port.");
const baseURL = `http://localhost:${port}`;
const engine = process.env.WISE_OFFLINE_BROWSER;
if (engine && engine !== "chromium" && engine !== "webkit") throw new Error("Wise offline browser must be chromium or webkit.");
// Preserve the exact Node runtime used to invoke Playwright, including on Windows.
const nodeExecutable = process.execPath.replaceAll("\\", "/");

export default defineConfig({
  testDir: "./e2e", testMatch: ["wise-usd-draft.spec.ts", "wise-usd-layout.spec.ts"], fullyParallel: false,
  workers: 1, retries: 0, forbidOnly: !!process.env.CI, failOnFlakyTests: !!process.env.CI,
  timeout: 300_000, expect: { timeout: 30_000 }, reporter: "list",
  outputDir: "test-results/wise-usd-draft",
  use: { baseURL, headless: true, trace: "retain-on-failure", screenshot: "only-on-failure", actionTimeout: 45_000 },
  webServer: {
    command: `"${nodeExecutable}" scripts/usdt-request-offline.mjs --wise-draft --port ${port} --no-seed${process.env.WISE_OFFLINE_PRODUCTION === "1" ? " --production" : ""}`,
    url: `${baseURL}/api/alpha-exchange/market-rate`, reuseExistingServer: false, timeout: 240_000,
    stdout: "pipe", stderr: "pipe",
  },
  projects: [
    ...(engine !== "webkit" ? [{ name: "wise-local-chromium", use: { ...devices["Desktop Chrome"],
      channel: process.env.WISE_OFFLINE_BROWSER_CHANNEL ?? (process.env.CI ? "chromium" : "chrome"),
      launchOptions: { args: ["--disable-gpu"] },
    } }] : []),
    ...(engine !== "chromium" ? [{ name: "wise-local-webkit", use: { ...devices["Desktop Safari"] } }] : []),
  ],
});
