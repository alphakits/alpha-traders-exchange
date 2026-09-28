import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  logEvent: vi.fn(),
  runSweep: vi.fn(),
}));

vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/marketplace-email-delivery", () => ({ deliverMarketplaceEmailQueue: mocks.runSweep }));

import { GET } from "@/app/api/cron/marketplace-email-delivery/route";

const secret = "0123456789abcdef0123456789abcdef";

function request(token = secret) {
  return new NextRequest("http://localhost/api/cron/marketplace-email-delivery", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("Marketplace email delivery cron", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", secret);
    mocks.runSweep.mockResolvedValue({ sent: 0, pending: 0, backlog: 0, failedTotal: 0 });
  });

  it("rejects an invalid cron credential without running work", async () => {
    const response = await GET(request("wrong-token"));
    expect(response.status).toBe(401);
    expect(mocks.runSweep).not.toHaveBeenCalled();
  });

  it("runs the authorized delivery sweep and returns aggregate counts", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, sent: 0, backlog: 0 });
    expect(mocks.runSweep).toHaveBeenCalledTimes(1);
  });

  it("returns a guarded failure when storage or delivery fails", async () => {
    mocks.runSweep.mockRejectedValueOnce(new Error("private database detail"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Marketplace email delivery sweep failed." });
  });
});
