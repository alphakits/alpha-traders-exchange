import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  saveSnapshot: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-repository", () => ({
  getAlphaExchangeRepository: vi.fn(async () => ({
    loadSnapshot: mocks.loadSnapshot,
    saveSnapshot: mocks.saveSnapshot,
  })),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  invalidateAlphaExchangeStoreCache: vi.fn(),
}));

import { GET as getSetup, POST as postSetup } from "@/app/api/admin/setup-test-accounts/route";
import { GET as getClean, POST as postClean } from "@/app/api/admin/clean-test-accounts/route";

function request(path: string, method: "GET" | "POST") {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "x-setup-secret": "test-secret" },
  });
}

describe("maintenance test-account routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    process.env.ALPHA_SETUP_SECRET = "test-secret";
    mocks.loadSnapshot.mockResolvedValue({
      users: [],
      sellerApplications: [],
      marketplaceListings: [],
      purchaseRequests: [],
      commissionRecords: [],
      notifications: [],
      authSessions: [],
    });
    mocks.saveSnapshot.mockResolvedValue(undefined);
  });

  it.each([
    ["setup", getSetup, postSetup, "/api/admin/setup-test-accounts"],
    ["clean", getClean, postClean, "/api/admin/clean-test-accounts"],
  ] as const)("blocks %s route methods in production before repository access", async (_name, get, post, path) => {
    vi.stubEnv("NODE_ENV", "production");

    const getResponse = await get(request(path, "GET"));
    const postResponse = await post(request(path, "POST"));

    expect(getResponse.status).toBe(404);
    expect(postResponse.status).toBe(404);
    expect(mocks.loadSnapshot).not.toHaveBeenCalled();
    expect(mocks.saveSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ["setup", getSetup, "/api/admin/setup-test-accounts"],
    ["clean", getClean, "/api/admin/clean-test-accounts"],
  ] as const)("keeps %s route available in development for the existing secret gate", async (_name, get, path) => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await get(request(path, "GET"));

    expect(response.status).not.toBe(404);
  });
});