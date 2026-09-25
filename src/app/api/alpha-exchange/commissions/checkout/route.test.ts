import { beforeEach, it, expect, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), issue: vi.fn(), state: vi.fn(), runtime: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiSellerWorkspaceActor: mocks.actor }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.rate }));
vi.mock("@/lib/commission-checkout-runtime", () => ({ getCommissionCheckoutRuntime: mocks.runtime }));
import { GET, POST } from "./route";
const body = { network: "BEP20", desiredAmount: "39", hasNotPaidYet: true };
function request(value: unknown = body, origin: string | null = "https://www.alphatraders.co.il") {
  return new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/commissions/checkout", { method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(value) });
}
beforeEach(() => { vi.clearAllMocks(); mocks.actor.mockResolvedValue({ user: { id: "seller" }, unauthorized: null });
  mocks.rate.mockResolvedValue({ allowed: true }); mocks.issue.mockResolvedValue({ id: "checkout", sellerId: "seller", network: "BEP20", expectedMicros: 39_000_000 });
  mocks.state.mockResolvedValue({ status: "ready", checkout: null }); mocks.runtime.mockResolvedValue({ issue: mocks.issue, state: mocks.state }); });
it("unauthenticated reads expose no financial data and are not cached", async () => { mocks.actor.mockResolvedValue({ user: null, unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }); const response = await GET(); expect(response?.status).toBe(401); expect(response?.headers.get("cache-control")).toContain("no-store"); expect(mocks.runtime).not.toHaveBeenCalled(); });
it("uses authenticated seller identity, not body actor/commission choices", async () => { const response = await POST(request()); expect(response.status).toBe(201); expect(mocks.issue).toHaveBeenCalledWith({ sellerId: "seller", network: "BEP20", desiredAmount: "39" }); expect((await response.json()).status).toBe("waiting"); });
it("rejects attempts to nominate another seller or mark paid", async () => { for (const field of ["sellerId", "actorUserId", "paid", "commissionIds"]) expect((await POST(request({ ...body, [field]: "other" }))).status).toBe(400); expect(mocks.issue).not.toHaveBeenCalled(); });
it("requires pre-payment acknowledgement and same-origin write", async () => { expect((await POST(request({ ...body, hasNotPaidYet: false }))).status).toBe(400); expect((await POST(request(body, "https://evil.test"))).status).toBe(403); expect((await POST(request(body, null))).status).toBe(403); expect(mocks.issue).not.toHaveBeenCalled(); });
it("rate limits issuance without modifying payment data", async () => { mocks.rate.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 }); const response = await POST(request()); expect(response.status).toBe(429); expect(mocks.issue).not.toHaveBeenCalled(); });
it("provider/store outage does not pretend that commissions are clear", async () => { mocks.runtime.mockRejectedValue(Error("private DB details")); const response = await GET(); expect(response?.status).toBe(503); expect(JSON.stringify(await response?.json())).not.toContain("private DB"); });
it("rejects oversized body and unsupported network", async () => { expect((await POST(request({ ...body, desiredAmount: "a".repeat(5000) }))).status).toBe(413); expect((await POST(request({ ...body, network: "ERC20" }))).status).toBe(400); });
