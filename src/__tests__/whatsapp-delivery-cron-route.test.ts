import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  logEvent: vi.fn(),
  runSweep: vi.fn(),
}));

vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));
vi.mock("@/lib/whatsapp-notifications", () => ({ runWhatsAppDeliverySweep: mocks.runSweep }));

import { GET } from "@/app/api/cron/whatsapp-delivery/route";

const secret = "0123456789abcdef0123456789abcdef";

function request(token = secret) {
  return new NextRequest("http://localhost/api/cron/whatsapp-delivery", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("WhatsApp delivery cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", secret);
    mocks.runSweep.mockResolvedValue({ enabled: false, claimed: 0, recovered: 0 });
  });

  it("rejects an invalid cron credential without running work", async () => {
    const response = await GET(request("wrong-token"));
    expect(response.status).toBe(401);
    expect(mocks.runSweep).not.toHaveBeenCalled();
  });

  it("runs independently and reports a disabled sender as a healthy no-op", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, enabled: false, claimed: 0 });
    expect(mocks.runSweep).toHaveBeenCalledTimes(1);
  });

  it("returns a guarded failure when storage or delivery fails", async () => {
    mocks.runSweep.mockRejectedValueOnce(new Error("private database detail"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "WhatsApp delivery sweep failed." });
  });
});
