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
it.each(["monitor", "enforce"])("requires the selected Ipregistry key in %s mode", (mode) => {
  vi.stubEnv("ALPHA_NETWORK_ACCESS_MODE", mode);
  vi.stubEnv("ALPHA_NETWORK_ACCESS_PROVIDER", "ipregistry");
  vi.stubEnv("PROXYCHECK_API_KEY", "synthetic-other-provider-key");
  vi.stubEnv("IPREGISTRY_API_KEY", "");
  expect(validateEnv().errors).toContain("IPREGISTRY_API_KEY is required when ipregistry network access checks are enabled.");
  vi.stubEnv("IPREGISTRY_API_KEY", "synthetic-selected-provider-key");
  vi.stubEnv("PROXYCHECK_API_KEY", "");
  expect(validateEnv().errors.filter((error) => /PROXYCHECK|IPREGISTRY/.test(error))).toEqual([]);
});
it("rejects an unknown provider instead of silently selecting another service", () => {
  vi.stubEnv("ALPHA_NETWORK_ACCESS_PROVIDER", "ipregsitry");
  expect(validateEnv().errors).toContain("ALPHA_NETWORK_ACCESS_PROVIDER must be proxycheck or ipregistry.");
});
it("rejects exposing the Ipregistry credential to browsers", () => {
  vi.stubEnv("NEXT_PUBLIC_IPREGISTRY_API_KEY", "synthetic-not-a-real-key");
  expect(validateEnv().errors).toContain("SECURITY: IPREGISTRY_API_KEY must be server-only, never NEXT_PUBLIC.");
});
