// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.auth }));
vi.mock("@/lib/alpha-exchange-store", () => ({ getSellerActiveTradeHeaderState: mocks.read }));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "seller", role: "approved_seller", sellerStatus: "approved_seller" } });
  mocks.read.mockResolvedValue([{ id: "trade-one" }, { id: "trade-two" }]);
});
describe("seller-scoped header endpoint", () => {
  it.each([401, 403, 503])("does not read trades when the session guard returns %s", async status => {
    mocks.auth.mockResolvedValue({ user: null, unauthorized: NextResponse.json({ error: "denied" }, { status }) });
    expect((await GET()).status).toBe(status);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("returns both trades for the server session and disables shared caching", async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ actorId: "seller", trades: [{ id: "trade-one" }, { id: "trade-two" }] });
    expect(mocks.read).toHaveBeenCalledWith("seller");
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });
  it.each(["buyer", "admin", "owner"])("does not give the seller list to an unrelated %s", async role => {
    mocks.auth.mockResolvedValue({ user: { id: "unrelated", role, sellerStatus: "buyer" } });
    expect((await GET()).status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("reports a read failure without exposing internals or claiming there are no active trades", async () => {
    mocks.read.mockRejectedValue(new Error("secret database details"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret database details");
  });
});
