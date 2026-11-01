// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiOwner: vi.fn(), requireApiAdmin: vi.fn(),
  forceCloseTradeByOwner: vi.fn(), forceCompleteTradeByAdmin: vi.fn(),
  forceCancelTradeByAdmin: vi.fn(), unlockTradeReviewByAdmin: vi.fn(),
}));
vi.mock("@/lib/api-auth", () => ({ requireApiOwner: mocks.requireApiOwner, requireApiAdmin: mocks.requireApiAdmin }));
vi.mock("@/lib/alpha-exchange-store", () => mocks);
import { POST as close } from "@/app/api/alpha-exchange/admin/purchase-requests/[requestId]/force-close/route";
import { POST as complete } from "@/app/api/alpha-exchange/admin/purchase-requests/[requestId]/force-complete/route";
import { POST as cancel } from "@/app/api/alpha-exchange/admin/purchase-requests/[requestId]/force-cancel/route";
import { POST as unlock } from "@/app/api/alpha-exchange/admin/purchase-requests/[requestId]/unlock-review/route";

const cases = [
  ["force-close", close, mocks.requireApiOwner, mocks.forceCloseTradeByOwner],
  ["force-complete", complete, mocks.requireApiAdmin, mocks.forceCompleteTradeByAdmin],
  ["force-cancel", cancel, mocks.requireApiAdmin, mocks.forceCancelTradeByAdmin],
  ["unlock-review", unlock, mocks.requireApiAdmin, mocks.unlockTradeReviewByAdmin],
] as const;
function request(action: string, reason = "  Verified by owner  ") {
  return new NextRequest(`https://www.alphatraders.co.il/api/alpha-exchange/admin/purchase-requests/trade-1/${action}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason, actorUserId: "forged-owner" }),
  });
}
const context = () => ({ params: Promise.resolve({ requestId: "trade-1" }) });

beforeEach(() => {
  vi.resetAllMocks();
  for (const auth of [mocks.requireApiAdmin, mocks.requireApiOwner]) auth.mockResolvedValue({ user: { id: "owner-1", role: "owner" }, unauthorized: null });
});

describe.each(cases)("%s authorization and validation", (action, handler, auth, store) => {
  it("binds the authenticated identity instead of the submitted actor", async () => {
    expect((await handler(request(action), context())).status).toBe(200);
    expect(store).toHaveBeenCalledWith({ requestId: "trade-1", actorUserId: "owner-1", reason: "Verified by owner" });
  });
  it.each([401, 403])("returns %i without invoking the mutation", async status => {
    auth.mockResolvedValue({ user: null, unauthorized: NextResponse.json({ error: "Access denied" }, { status }) });
    expect((await handler(request(action), context())).status).toBe(status);
    expect(store).not.toHaveBeenCalled();
  });
  it("rejects an empty reason", async () => {
    expect((await handler(request(action, "  "), context())).status).toBe(400);
    expect(store).not.toHaveBeenCalled();
  });
  it("returns a server guard failure without reporting success", async () => {
    store.mockRejectedValueOnce(new Error("Trade changed; refresh first."));
    const response = await handler(request(action), context());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Trade changed; refresh first." });
  });
});
