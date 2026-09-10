// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reverifyPendingCommissionPayments: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  reverifyPendingCommissionPayments: mocks.reverifyPendingCommissionPayments,
}));

import { GET } from "@/app/api/cron/commission-payment-verification/route";

const SECRET = "test-cron-secret-that-is-at-least-32-characters";

function request(authorization?: string) {
  return new NextRequest("https://www.alphatraders.co.il/api/cron/commission-payment-verification", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("automatic commission payment verification cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.reverifyPendingCommissionPayments.mockResolvedValue({
      checked: 2,
      verified: 1,
      stillPending: 1,
      failed: 0,
      errors: 0,
    });
  });

  it("fails closed when CRON_SECRET is absent or too short", async () => {
    vi.stubEnv("CRON_SECRET", "short");

    const response = await GET(request("Bearer short"));

    expect(response.status).toBe(503);
    expect(mocks.reverifyPendingCommissionPayments).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    const response = await GET(request("Bearer wrong-secret"));

    expect(response.status).toBe(401);
    expect(mocks.reverifyPendingCommissionPayments).not.toHaveBeenCalled();
  });

  it("rechecks bounded pending payments without caching", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      checked: 2,
      verified: 1,
      stillPending: 1,
      failed: 0,
      errors: 0,
    });
    expect(mocks.reverifyPendingCommissionPayments).toHaveBeenCalledWith({ limit: 4 });
  });
});
