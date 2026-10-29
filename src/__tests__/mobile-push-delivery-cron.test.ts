// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ sweep: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/mobile-push", () => ({ runMobilePushDeliverySweep: mocks.sweep }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.log }));
import { GET } from "@/app/api/cron/mobile-push-delivery/route";
const secret = "mock-cron-secret-with-at-least-32-characters";
const request = (authorization?: string) => new NextRequest("https://www.alphatraders.co.il/api/cron/mobile-push-delivery", {
  headers: authorization ? { authorization } : {},
});
describe("native push recovery scheduler", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", secret); mocks.sweep.mockResolvedValue({ processed: 3, failed: 0 }); });
  afterEach(() => vi.unstubAllEnvs());
  it.each([undefined, "Bearer wrong", `Bearer ${secret}extra`])("denies an unauthorized request (%s)", async value => {
    const response = await GET(request(value));
    expect(response.status).toBe(401);
    expect(mocks.sweep).not.toHaveBeenCalled();
  });
  it("fails closed without a configured scheduler secret", async () => {
    vi.stubEnv("CRON_SECRET", "short");
    expect((await GET(request("Bearer short"))).status).toBe(503);
    expect(mocks.sweep).not.toHaveBeenCalled();
  });
  it("runs authorized recovery and never caches its response", async () => {
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, processed: 3, failed: 0 });
    expect(mocks.sweep).toHaveBeenCalledTimes(1);
  });
  it("returns a failure without leaking provider details", async () => {
    mocks.sweep.mockRejectedValue(new Error("private-token-value"));
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private-token-value");
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("private-token-value");
  });
});
