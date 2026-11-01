import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const state = vi.hoisted(() => ({ user: { id: "signed-in-user" } as { id: string } | null, record: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentSessionToken: async () => "server-cookie-token", getCurrentSessionUser: async () => state.user }));
vi.mock("@/lib/api-auth", () => ({ requireApiUser: async () => ({ user: state.user, unauthorized: NextResponse.json({}, { status: 401 }) }) }));
vi.mock("@/lib/alpha-exchange-store", () => ({ getVisibleUserPresence: state.read }));
vi.mock("@/lib/user-presence-store", () => ({ recordUserPresence: state.record, presenceSessionKey: () => "hashed-session" }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: async () => ({ allowed: true }) }));
import { GET, POST } from "./route";
const update = { clientId: "95521f43-b934-44de-bd8d-820c17219a00", sequence: 1, active: true, activity: true };
const post = (body: object, origin = "https://www.alphatraders.co.il") => new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/presence", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); state.user = { id: "signed-in-user" }; state.read.mockResolvedValue({}); state.record.mockResolvedValue(undefined); });
describe("presence API authority and freshness", () => {
  it("accepts only the server-authenticated user and server timestamps", async () => {
    expect((await POST(post(update))).status).toBe(200);
    expect(state.record).toHaveBeenCalledWith("signed-in-user", "hashed-session", update);
    expect((await POST(post({ ...update, userId: "another-user", lastActiveAt: "2099-01-01" }))).status).toBe(400);
  });
  it("rejects cross-origin, malformed, and unsigned activity", async () => {
    expect((await POST(post(update, "https://other.example"))).status).toBe(403);
    expect((await POST(post({ ...update, sequence: -1 }))).status).toBe(400);
    state.user = null;
    expect((await POST(post(update))).status).toBe(401);
    expect(state.record).not.toHaveBeenCalled();
  });
  it("batches only bounded IDs and never creates activity during a read", async () => {
    const response = await GET(new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/presence?ids=seller,buyer"));
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(state.read).toHaveBeenCalledWith(["seller", "buyer"], state.user);
    expect(state.record).not.toHaveBeenCalled();
    expect((await GET(new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/presence?ids="))).status).toBe(400);
  });
});
