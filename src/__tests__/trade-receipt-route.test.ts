import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildTradeReceipt } from "@/lib/trade-receipt";
import { receiptRequest, receiptCommission } from "@/test-utils/trade-receipt";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), room: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.auth }));
vi.mock("@/lib/alpha-exchange-store", () => ({ getTradeRoomData: mocks.room }));
import { GET } from "@/app/api/alpha-exchange/purchase-requests/[requestId]/receipt/route";
const call = (query = "") => GET(new NextRequest(`https://example.test/api/alpha-exchange/purchase-requests/receipt-trade/receipt${query}`), { params: Promise.resolve({ requestId: "receipt-trade" }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "buyer", role: "buyer" } });
  mocks.room.mockResolvedValue({ request: { completionReceipt: buildTradeReceipt(receiptRequest(), receiptCommission, "completion") } });
});
it("requires a session even for HTML downloads", async () => {
  mocks.auth.mockResolvedValue({ user: null });
  const response = await call("?format=html&download=1");
  expect(response.status).toBe(401); expect(mocks.room).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toContain("private, no-store");
});
it("ignores query-supplied owner roles and requests a fresh authorized room without mutating read receipts", async () => {
  const response = await call("?role=owner&userId=owner");
  expect(response.status).toBe(200);
  expect(mocks.room).toHaveBeenCalledWith({ purchaseRequestId: "receipt-trade", actorUserId: "buyer", actorRole: "buyer", strongConsistency: true, markMessagesRead: false });
  const body = await response.text(); expect(body).not.toContain("PRIVATE");
  expect(response.headers.get("cache-control")).toContain("private, no-store");
});
it.each(["Trade not found.", "You are not allowed to access trade evidence."])("does not disclose existence when access fails: %s", async message => {
  mocks.room.mockRejectedValue(new Error(message));
  const response = await call(); expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({ error: "Receipt not found." });
});
it("returns a private, self-contained Arabic attachment with restrictive security headers", async () => {
  const response = await call("?format=html&download=1&locale=ar");
  expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
  expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
  expect(response.headers.get("x-robots-tag")).toContain("noindex");
  expect(await response.text()).toContain('lang="ar" dir="rtl"');
});
it("does not issue a receipt before completion", async () => {
  mocks.room.mockResolvedValue({ request: {} }); expect((await call()).status).toBe(404);
});
