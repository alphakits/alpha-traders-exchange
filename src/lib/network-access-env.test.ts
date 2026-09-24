// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { validateEnv } from "./env-validation";
afterEach(() => vi.unstubAllEnvs());
it.each(["monitor", "enforce"])("refuses activating %s without a provider key", (mode) => {
  vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", mode); vi.stubEnv("PROXYCHECK_API_KEY", "");
  expect(validateEnv().errors).toContain("PROXYCHECK_API_KEY is required when network access checks are enabled.");
});
it("rejects a typo instead of silently switching protection off", () => {
  vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", "enfroce");
  expect(validateEnv().errors).toContain("ALPHA_NETWORK_ACCESS_MODE must be off, monitor, or enforce.");
});
it("rejects exposing the detection credential to browsers", () => {
  vi.stubEnv("NEXT_PUBLIC_PROXYCHECK_API_KEY", "synthetic-not-a-real-key");
  expect(validateEnv().errors).toContain("SECURITY: PROXYCHECK_API_KEY must be server-only, never NEXT_PUBLIC.");
});
