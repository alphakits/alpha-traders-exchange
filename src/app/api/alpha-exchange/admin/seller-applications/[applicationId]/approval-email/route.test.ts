// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), send: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiAdmin: mocks.auth }));
vi.mock("@/lib/alpha-exchange-store", () => ({ sendSellerApprovalEmailByAdmin: mocks.send }));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...await original<typeof import("@/lib/rate-limit")>(), checkSharedRateLimit: mocks.limit,
}));
import { POST } from "./route";
const context = { params: Promise.resolve({ applicationId: "application-1" }) };
function request() {
  return new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/admin/seller-applications/application-1/approval-email", {
    method: "POST", body: JSON.stringify({ to: "untrusted@example.test", userId: "someone-else" }),
  });
}
describe("admin approval-email recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "owner-1", role: "owner" } });
    mocks.limit.mockResolvedValue({ allowed: true });
    mocks.send.mockResolvedValue({ ok: true });
  });
  it("uses the authenticated admin and application only, and reports provider acceptance", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith("application-1", "owner-1");
    await expect(response.json()).resolves.toEqual({ status: "accepted_for_delivery" });
  });
  it("rejects unauthorized callers before rate limiting or sending", async () => {
    mocks.auth.mockResolvedValueOnce({ user: null, unauthorized: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    expect((await POST(request(), context)).status).toBe(403);
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("rate limits repeated recovery requests", async () => {
    mocks.limit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 900 });
    const response = await POST(request(), context);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not claim success when the email provider fails", async () => {
    mocks.send.mockResolvedValueOnce({ ok: false });
    const response = await POST(request(), context);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: expect.stringContaining("seller is still approved") });
  });
  it("rejects stale or ineligible approvals", async () => {
    mocks.send.mockRejectedValueOnce(new Error("Approval emails can only be sent to an active approved seller."));
    expect((await POST(request(), context)).status).toBe(400);
  });
});
