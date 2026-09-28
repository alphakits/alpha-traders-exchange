import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  allowsLocalTestSupportRequest,
  allowsTestOnlyRuntime,
  isProductionSecurityRuntime,
} from "@/lib/runtime-safety";

describe("runtime safety boundaries", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed for test support in a deployed production runtime even with unsafe flags", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALPHA_E2E_TEST_SUPPORT", "1");
    vi.stubEnv("ALPHA_E2E_LOOPBACK_ONLY", "1");

    expect(isProductionSecurityRuntime()).toBe(true);
    expect(allowsTestOnlyRuntime()).toBe(false);
    expect(allowsLocalTestSupportRequest(
      new NextRequest("https://alphatraders.co.il/api/testing/alpha-exchange-state"),
    )).toBe(false);
  });

  it("permits the explicit local production E2E runtime only on loopback", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("ALPHA_E2E_TEST_SUPPORT", "1");
    vi.stubEnv("ALPHA_E2E_LOOPBACK_ONLY", "1");

    expect(isProductionSecurityRuntime()).toBe(false);
    expect(allowsTestOnlyRuntime()).toBe(true);
    expect(allowsLocalTestSupportRequest(
      new NextRequest("http://localhost:3100/api/testing/alpha-exchange-state"),
    )).toBe(true);
    expect(allowsLocalTestSupportRequest(
      new NextRequest("https://preview.example.test/api/testing/alpha-exchange-state"),
    )).toBe(false);
  });

  it("does not downgrade a non-Vercel production process with only the old test marker", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("ALPHA_E2E_TEST_SUPPORT", "1");
    vi.stubEnv("ALPHA_E2E_LOOPBACK_ONLY", "");

    expect(isProductionSecurityRuntime()).toBe(true);
    expect(allowsTestOnlyRuntime()).toBe(false);
  });
});
