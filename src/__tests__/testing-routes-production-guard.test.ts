import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  saveSnapshot: vi.fn(),
  invalidateAlphaExchangeStoreCache: vi.fn(),
  runAlphaExchangeMaintenance: vi.fn(),
  listMarketplaceEmailAttempts: vi.fn(),
  clearMarketplaceEmailAttempts: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-repository", () => ({
  getAlphaExchangeRepository: vi.fn(async () => ({
    loadSnapshot: mocks.loadSnapshot,
    saveSnapshot: mocks.saveSnapshot,
  })),
}));
vi.mock("@/lib/alpha-exchange-store", () => ({
  invalidateAlphaExchangeStoreCache: mocks.invalidateAlphaExchangeStoreCache,
  runAlphaExchangeMaintenance: mocks.runAlphaExchangeMaintenance,
}));
vi.mock("@/lib/marketplace-email-delivery", () => ({
  listMarketplaceEmailAttempts: mocks.listMarketplaceEmailAttempts,
  clearMarketplaceEmailAttempts: mocks.clearMarketplaceEmailAttempts,
}));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));

import { GET as getRuntimeState } from "@/app/api/testing/alpha-exchange-state/route";
import { GET as getEmailAttempts } from "@/app/api/testing/marketplace-email-attempts/route";

function testingRequest(url: string) {
  return new NextRequest(url, { headers: { "x-alpha-test-support": "enabled" } });
}

describe("test-support routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadSnapshot.mockResolvedValue({ notifications: [] });
    mocks.listMarketplaceEmailAttempts.mockReturnValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 404 in deployed production even when a legacy test flag is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ALPHA_ENABLE_TEST_SUPPORT", "1");
    vi.stubEnv("ALPHA_E2E_TEST_SUPPORT", "1");

    expect((await getRuntimeState(testingRequest("https://alphatraders.co.il/api/testing/alpha-exchange-state"))).status).toBe(404);
    expect((await getEmailAttempts(testingRequest("https://alphatraders.co.il/api/testing/marketplace-email-attempts"))).status).toBe(404);
    expect(mocks.loadSnapshot).not.toHaveBeenCalled();
    expect(mocks.listMarketplaceEmailAttempts).not.toHaveBeenCalled();
  });

  it("allows the explicit local Playwright runtime over loopback", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("ALPHA_E2E_TEST_SUPPORT", "1");
    vi.stubEnv("ALPHA_E2E_LOOPBACK_ONLY", "1");

    expect((await getRuntimeState(testingRequest("http://localhost:3100/api/testing/alpha-exchange-state"))).status).toBe(200);
    expect((await getEmailAttempts(testingRequest("http://localhost:3100/api/testing/marketplace-email-attempts"))).status).toBe(200);
  });
});
