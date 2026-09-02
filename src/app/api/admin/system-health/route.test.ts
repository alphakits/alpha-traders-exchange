import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  healthCheck: vi.fn(),
  logEvent: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({ requireApiAdmin: mocks.requireApiAdmin }));
vi.mock("@/lib/alpha-exchange-repository", () => ({
  getAlphaExchangeRepository: vi.fn(async () => ({ healthCheck: mocks.healthCheck })),
}));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));

import { GET } from "./route";

describe("admin system health route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAdmin.mockResolvedValue({ user: { id: "owner-1", role: "owner" }, unauthorized: null });
    mocks.healthCheck.mockResolvedValue("ok");
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
    const payload = await response.json() as { status: string; checks: Array<{ key: string; status: string }> };
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.status).toBe("healthy");
    expect(payload.checks.find((check) => check.key === "database")?.status).toBe("healthy");
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
});
