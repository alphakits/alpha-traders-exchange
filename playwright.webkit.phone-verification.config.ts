import { defineConfig } from "@playwright/test";
import phoneVerification from "./playwright.phone-verification.config";
import webkit from "./playwright.webkit.config";

export default defineConfig({
  ...phoneVerification,
  projects: webkit.projects,
});
