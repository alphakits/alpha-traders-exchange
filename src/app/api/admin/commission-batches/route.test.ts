import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ owner: vi.fn(), rate: vi.fn(), approve: vi.fn(), state: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiOwner: mocks.owner }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.rate }));
vi.mock("@/lib/commission-batch-runtime", () => ({ getCommissionBatchRuntime: async () => ({ approve: mocks.approve, ownerState: mocks.state }) }));
import { GET, POST } from "./route";
const body = { sellerId: "seller", commissionIds: ["cm42", "cm43"], signature: "binance-deposit:1234567", network: "BEP20", confirmedOriginalPayer: true };
function request(value: unknown = body, origin: string | null = "https://example.test") {
  return new NextRequest("https://example.test/api/admin/commission-batches", { method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(value) });
}
beforeEach(() => {
  vi.stubEnv("ALPHA_EXCHANGE_COMMISSION_BATCH_V1", "1"); vi.clearAllMocks();
  mocks.owner.mockResolvedValue({ user: { id: "real-owner" }, unauthorized: null });
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.approve.mockResolvedValue({ id: "batch", expectedAmountMicros: 38_300_000 });
  mocks.state.mockResolvedValue({ batches: [], commissions: [] });
});
afterEach(() => vi.unstubAllEnvs());
describe("owner-only batch receipt association", () => {
  it("returns 202 awaiting verification, never claims payment from owner assertion", async () => {
    const response = await POST(request({ ...body, actorUserId: "spoofed", amount: 38, waived: 100 }));
    expect(response!.status).toBe(202); expect((await response!.json()).status).toBe("awaiting_receipt_verification");
    expect(mocks.approve).toHaveBeenCalledWith({ actorUserId: "real-owner", sellerId: "seller", commissionIds: ["cm42", "cm43"], signature: body.signature, network: "BEP20" });
  });
  it("rejects unauthenticated or non-owner callers before reading ledger", async () => {
    mocks.owner.mockResolvedValue({ user: null, unauthorized: NextResponse.json({}, { status: 403 }) });
    expect((await GET())!.status).toBe(403); expect((await POST(request()))!.status).toBe(403); expect(mocks.state).not.toHaveBeenCalled(); expect(mocks.approve).not.toHaveBeenCalled();
  });
  it("refuses cross-origin and missing-origin browser approvals", async () => {
    expect((await POST(request(body, "https://other.test")))!.status).toBe(403);
    expect((await POST(request(body, null)))!.status).toBe(403); expect(mocks.approve).not.toHaveBeenCalled();
  });
  it("requires independent payer confirmation and valid membership", async () => {
    for (const value of [{ ...body, confirmedOriginalPayer: false }, { ...body, commissionIds: [] }, { ...body, commissionIds: ["cm42", "cm42"] }, { ...body, network: "ERC20" }, { ...body, signature: "not-a-receipt" }]) {
      expect((await POST(request(value)))!.status).toBe(400);
    }
    expect(mocks.approve).not.toHaveBeenCalled();
  });
  it("rollout disabled never authorizes any group", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_COMMISSION_BATCH_V1", "0"); expect((await POST(request()))!.status).toBe(503); expect(mocks.approve).not.toHaveBeenCalled();
  });
  it("applies server-side rate limit", async () => {
    mocks.rate.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 }); const response = await POST(request()); expect(response!.status).toBe(429); expect(response!.headers.get("retry-after")).toBe("30");
  });
  it("does not cache owner financial data", async () => {
    expect((await GET())!.headers.get("cache-control")).toContain("no-store");
  });
  it("database failure does not return a success or expose its error", async () => {
    mocks.approve.mockRejectedValue(new Error("private-connection-string")); const response = await POST(request()); expect(response!.status).toBe(503); expect(JSON.stringify(await response!.json())).not.toContain("private");
  });
});
