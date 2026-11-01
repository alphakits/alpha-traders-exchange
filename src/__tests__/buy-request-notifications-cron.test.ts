// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ sweep: vi.fn(), enabled: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/usdt-demand-store", () => ({ runDemandExpiryNotifications: mocks.sweep }));
vi.mock("@/lib/usdt-demand-policy", () => ({ demandEnabled: mocks.enabled }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.log }));
import { GET } from "@/app/api/cron/buy-request-notifications/route";

const secret = "mock-buy-request-cron-secret-with-32-characters";
function request(authorization?: string) {
  return new NextRequest("https://www.alphatraders.co.il/api/cron/buy-request-notifications", {
    headers: authorization ? { authorization } : {},
  });
}
describe("Buy Request expiry notification scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", secret);
    mocks.enabled.mockReturnValue(true);
    mocks.sweep.mockResolvedValue({ notified: 3 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "Bearer wrong", `Bearer ${secret}extra`, `Bearer ${"x".repeat(secret.length)}`])(
    "rejects unauthorized requests before checking feature state (%s)", async authorization => {
      mocks.enabled.mockReturnValue(false);
      const response = await GET(request(authorization));
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(mocks.enabled).not.toHaveBeenCalled();
      expect(mocks.sweep).not.toHaveBeenCalled();
    },
  );
  it.each(["", "short"])("fails closed with an invalid scheduler secret (%s)", async configured => {
    vi.stubEnv("CRON_SECRET", configured);
    const response = await GET(request(`Bearer ${configured}`));
    expect(response.status).toBe(503);
    expect(mocks.enabled).not.toHaveBeenCalled();
    expect(mocks.sweep).not.toHaveBeenCalled();
  });
  it("does not load or mutate request storage while Buy Requests is disabled", async () => {
    mocks.enabled.mockReturnValue(false);
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, enabled: false, notified: 0 });
    expect(mocks.sweep).not.toHaveBeenCalled();
  });
  it("runs the authorized notification sweep and reports its count without caching", async () => {
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, enabled: true, notified: 3 });
    expect(mocks.sweep).toHaveBeenCalledTimes(1);
  });
  it("reports a retryable scheduler failure without exposing private database details", async () => {
    mocks.sweep.mockRejectedValue(new Error("private-recipient-email-and-database-connection"));
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toContain("private-recipient");
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("private-recipient");
    expect(mocks.log).toHaveBeenCalledWith("error", expect.objectContaining({ outcome: "failed", reason: "expiry_notice_sweep_failed" }));
  });
});
