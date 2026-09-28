import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  healthCheck: vi.fn(),
  loadOperationalHealthData: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiAdmin: mocks.requireApiAdmin }));
vi.mock("@/lib/alpha-exchange-repository", () => ({
  getAlphaExchangeRepository: vi.fn(async () => ({
    healthCheck: mocks.healthCheck,
    loadOperationalHealthData: mocks.loadOperationalHealthData,
  })),
}));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));

import { GET } from "./route";

describe("admin system health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAdmin.mockResolvedValue({ user: { id: "owner-1", role: "owner" }, unauthorized: null });
    mocks.healthCheck.mockResolvedValue("ok");
    mocks.loadOperationalHealthData.mockResolvedValue({ marketplaceListings: [], purchaseRequests: [] });
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-value";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-value";
    process.env.RESEND_API_KEY = "resend-test-value";
    process.env.EMAIL_FROM = "Alpha Traders <notifications@example.test>";
  });

  it("rejects users without admin access", async () => {
    mocks.requireApiAdmin.mockResolvedValueOnce({
      user: null,
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.healthCheck).not.toHaveBeenCalled();
  });

  it("returns live dependency status without exposing configuration secrets", async () => {
    const response = await GET();
    const payload = await response.json() as {
      status: string;
      checks: Array<{ key: string; status: string }>;
      operations: { status: string; incidents: unknown[] };
    };
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.status).toBe("healthy");
    expect(payload.checks.find((check) => check.key === "database")?.status).toBe("healthy");
    expect(payload.checks.find((check) => check.key === "marketplace_operations")?.status).toBe("healthy");
    expect(payload.operations).toMatchObject({ status: "healthy", incidents: [] });
    expect(serialized).not.toContain("service-test-value");
    expect(serialized).not.toContain("resend-test-value");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("reports a database outage as degraded while keeping diagnostics readable", async () => {
    mocks.healthCheck.mockRejectedValueOnce(new Error("connection refused"));

    const response = await GET();
    const payload = await response.json() as { status: string; checks: Array<{ key: string; status: string }> };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("degraded");
    expect(payload.checks.find((check) => check.key === "database")?.status).toBe("degraded");
    expect(payload.checks.find((check) => check.key === "trade_room")?.status).toBe("degraded");
    expect(mocks.logEvent).toHaveBeenCalledWith("error", expect.objectContaining({
      event: "system_health_database_check",
      outcome: "failed",
    }));
  });

  it("surfaces a stale price offer as an owner-visible operational warning", async () => {
    mocks.loadOperationalHealthData.mockResolvedValueOnce({
      marketplaceListings: [],
      purchaseRequests: [{
        id: "request-stale-offer",
        tradeId: "trade-stale-offer",
        buyerId: "buyer-1",
        listingId: "listing-1",
        sellerId: "seller-1",
        buyerName: "Buyer",
        usdtAmount: "500",
        fiatAmount: "1475",
        pricePerUsdt: "2.95",
        listingPriceAtRequest: "3.30",
        priceMode: "buyer_offer",
        currency: "ILS",
        network: "TRC20",
        paymentMethod: "Bank Transfer",
        timeline: [],
        status: "pending",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
    });

    const response = await GET();
    const payload = await response.json() as {
      status: string;
      operations: { status: string; stalePriceOffers: number; incidents: Array<{ requestId?: string }> };
    };

    expect(payload.status).toBe("degraded");
    expect(payload.operations.status).toBe("attention");
    expect(payload.operations.stalePriceOffers).toBe(1);
    expect(payload.operations.incidents[0]?.requestId).toBe("request-stale-offer");
  });

  it("keeps the health response usable when operational data cannot be loaded", async () => {
    mocks.loadOperationalHealthData.mockRejectedValueOnce(new Error("query failed"));

    const response = await GET();
    const payload = await response.json() as {
      status: string;
      operations: null;
      checks: Array<{ key: string; status: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("degraded");
    expect(payload.operations).toBeNull();
    expect(payload.checks.find((check) => check.key === "marketplace_operations")?.status).toBe("degraded");
    expect(mocks.logEvent).toHaveBeenCalledWith("error", expect.objectContaining({
      event: "system_health_marketplace_operations",
      outcome: "failed",
    }));
  });
});
