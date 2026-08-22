import { afterEach, describe, expect, it, vi } from "vitest";

import { validateEnv } from "@/lib/env-validation";

describe("production environment safety validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects bypass, QA, test-support, in-memory, and diagnostic flags in a deployed runtime", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALPHA_ENABLE_TEST_SUPPORT", "1");
    vi.stubEnv("ALPHA_E2E_TEST_SUPPORT", "1");
    vi.stubEnv("ALPHA_E2E_LOOPBACK_ONLY", "1");
    vi.stubEnv("ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY", "1");
    vi.stubEnv("ALPHA_EXCHANGE_QA_MODE", "1");
    vi.stubEnv("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION", "1");
    vi.stubEnv("PHOTO_VERIFICATION_BYPASS_EMAILS", "test@example.com");
    vi.stubEnv("AUTH_COOKIE_SECURE", "false");

    const { errors } = validateEnv();
    expect(errors.join("\n")).toContain("ALPHA_ENABLE_TEST_SUPPORT");
    expect(errors.join("\n")).toContain("ALPHA_E2E_TEST_SUPPORT");
    expect(errors.join("\n")).toContain("ALPHA_E2E_LOOPBACK_ONLY");
    expect(errors.join("\n")).toContain("ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY");
    expect(errors.join("\n")).toContain("ALPHA_EXCHANGE_QA_MODE");
    expect(errors.join("\n")).toContain("ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION");
    expect(errors.join("\n")).toContain("PHOTO_VERIFICATION_BYPASS_EMAILS");
    expect(errors.join("\n")).toContain("AUTH_COOKIE_SECURE=false");
  });

  it("requires marketplace relay credentials as an all-or-none production configuration", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("DISCORD_MARKETPLACE_API_KEY", "configured");

    const { errors } = validateEnv();
    expect(errors.join("\n")).toContain("DISCORD_MARKETPLACE_WEBHOOK_URL");
    expect(errors.join("\n")).toContain("DISCORD_MARKETPLACE_WEBHOOK_SECRET");
  });
});
