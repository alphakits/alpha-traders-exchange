import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

// Reuse the same production build, loopback-only fixtures and assertions.
// WebKit is browser-engine coverage, not a physical iPhone certification.
export default defineConfig({
  ...base,
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"] } }],
});
