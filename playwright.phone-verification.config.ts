import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const webServer = base.webServer;
if (!webServer || Array.isArray(webServer)) throw new Error("Expected one isolated E2E server.");

export default defineConfig({
  ...base,
  testMatch: "**/phone-verification-gate.spec.ts",
  testIgnore: [],
  webServer: {
    ...webServer,
    env: {
      ...webServer.env,
      ALPHA_EXCHANGE_PHONE_VERIFICATION_ENABLED: "true",
      ALPHA_EXCHANGE_PHONE_VERIFICATION_REQUIRED: "true",
      ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION: "0",
      ALPHA_EXCHANGE_PHONE_VERIFICATION_PROVIDER: "disabled",
      ALPHA_EXCHANGE_TWILIO_OTP_SEND_ENABLED: "false",
      ALPHA_EXCHANGE_TWILIO_SEND_ENABLED: "false",
      ALPHA_EXCHANGE_WHATSAPP_SEND_ENABLED: "false",
      ALPHA_EXCHANGE_WHATSAPP_AUTH_SEND_ENABLED: "false",
    },
  },
});
