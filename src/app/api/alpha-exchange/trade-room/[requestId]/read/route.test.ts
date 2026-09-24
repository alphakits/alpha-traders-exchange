// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ user: vi.fn(), room: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.user, requireEmailVerificationForTrading: () => null }));
vi.mock("@/lib/alpha-exchange-store", () => ({ getTradeRoomData: mocks.room }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.limit }));
import { POST } from "./route";
import { GET as readRoom } from "../route";

const context = { params: Promise.resolve({ requestId: "trade-1" }) };
function request(body: unknown, origin = "https://www.alphatraders.co.il") {
  return new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/trade-room/trade-1/read", {
    method: "POST", headers: { origin, "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ user: { id: "buyer", role: "buyer" }, unauthorized: null });
  mocks.limit.mockResolvedValue({ allowed: true });
  mocks.room.mockResolvedValue({ request: { buyerId: "buyer", sellerId: "seller" }, messages: [
    { id: "message-1", readByUserIds: ["buyer", "seller"], seenAt: "2026-09-24T12:00:00Z", message: "Private body", imageName: "Private Name.png" },
    { id: "not-displayed", readByUserIds: ["seller"] },
  ] });
});
describe("participant read receipt endpoint", () => {
  it("keeps ordinary room fetches read-only", async () => {
    const response = await readRoom(new NextRequest("https://www.alphatraders.co.il/api/alpha-exchange/trade-room/trade-1"), context);
    expect(response.status).toBe(200);
    expect(mocks.room).toHaveBeenCalledWith(expect.objectContaining({ markMessagesRead: false }));
  });
  it("uses the authenticated reader and exact displayed IDs, returning only receipt metadata", async () => {
    const response = await POST(request({ messageIds: ["message-1"] }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.room).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "buyer", actorRole: "buyer", readMessageIds: ["message-1"], markMessagesRead: true, strongConsistency: true }));
    const payload = await response.json();
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]).toEqual({ id: "message-1", readByUserIds: ["buyer", "seller"], seenAt: "2026-09-24T12:00:00Z" });
    expect(JSON.stringify(payload)).not.toContain("Private");
  });
  it("rejects unauthenticated or cross-origin requests before touching receipts", async () => {
    expect((await POST(request({ messageIds: ["message-1"] }, "https://example.test"), context)).status).toBe(403);
    mocks.user.mockResolvedValue({ user: null, unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    expect((await POST(request({ messageIds: ["message-1"] }), context)).status).toBe(401);
    expect(mocks.room).not.toHaveBeenCalled();
  });
  it("rejects spoofed identity, oversized batches, and owner inspection as a participant receipt", async () => {
    expect((await POST(request({ messageIds: ["message-1"], actorUserId: "seller" }), context)).status).toBe(400);
    expect((await POST(request({ messageIds: Array.from({ length: 101 }, (_, index) => `message-${index}`) }), context)).status).toBe(400);
    expect(mocks.room).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ user: { id: "owner", role: "owner" }, unauthorized: null });
    expect((await POST(request({ messageIds: ["message-1"] }), context)).status).toBe(403);
  });
  it("bounds repeated requests without touching the trade", async () => {
    mocks.limit.mockResolvedValue({ allowed: false });
    expect((await POST(request({ messageIds: ["message-1"] }), context)).status).toBe(429);
    expect(mocks.room).not.toHaveBeenCalled();
  });
});
