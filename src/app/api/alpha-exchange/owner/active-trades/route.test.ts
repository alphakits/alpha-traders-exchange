// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiOwner: mocks.auth }));
vi.mock("@/lib/alpha-exchange-store", () => ({ getOwnerActiveTradeHeaderState: mocks.read }));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner", role: "owner" } });
  mocks.read.mockResolvedValue([{ id: "trade-one" }, { id: "trade-two" }]);
});
describe("owner-only header endpoint", () => {
  it.each([401, 403, 503])("does not read trades when the owner guard returns %s", async status => {
    mocks.auth.mockResolvedValue({ user: null, unauthorized: NextResponse.json({ error: "denied" }, { status }) });
    expect((await GET()).status).toBe(status);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("returns both trades for the server session and disables shared caching", async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ actorId: "owner", trades: [{ id: "trade-one" }, { id: "trade-two" }] });
    expect(mocks.read).toHaveBeenCalledWith("owner", "owner");
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });
  it("reports a read failure without exposing internals or claiming there are no active trades", async () => {
    mocks.read.mockRejectedValue(new Error("secret database details"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret database details");
  });
});
