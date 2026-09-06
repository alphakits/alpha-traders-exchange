// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  getTradeRoomData: vi.fn(),
  logEvent: vi.fn(),
  postTradeRoomMessage: vi.fn(),
  prepareTradeRoomConversationEmail: vi.fn(),
  requireMobileApiUser: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after,
}));
vi.mock("@/lib/mobile-api-auth", () => ({ requireMobileApiUser: mocks.requireMobileApiUser }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  getTradeRoomData: mocks.getTradeRoomData,
  postTradeRoomMessage: mocks.postTradeRoomMessage,
}));
vi.mock("@/lib/marketplace-email-events", () => ({
  prepareTradeRoomConversationEmail: mocks.prepareTradeRoomConversationEmail,
  TRADE_ROOM_MESSAGE_EMAIL_BURST_WINDOW_MS: 120_000,
}));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.checkSharedRateLimit }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));

import { POST } from "@/app/api/mobile/v1/trades/[requestId]/messages/route";
import { DIRECT_CONTACT_CONTENT_ERROR } from "@/lib/privacy-redaction";

const clientMessageId = "4f4779eb-cb34-4d4b-b729-69d03d6e1381";

function request(body: Record<string, unknown>, locale = "en") {
  return new NextRequest("https://www.alphatraders.co.il/api/mobile/v1/trades/purchase-1/messages", {
    method: "POST",
    headers: {
      "accept-language": locale,
      "authorization": "Bearer token",
      "content-type": "application/json",
      "x-app-version": "1.0.0",
      "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
      "x-platform": "ios",
      "x-request-id": "mobile-message-request",
    },
    body: JSON.stringify(body),
  });
}

function context() {
  return { params: Promise.resolve({ requestId: "purchase-1" }) };
}

function room() {
  return {
    request: { id: "purchase-1", buyerId: "buyer-1", sellerId: "private-seller-id" },
    messages: [],
    counterpart: { buyerName: "Buyer", sellerName: "Seller" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMobileApiUser.mockResolvedValue({
    user: { id: "buyer-1", role: "buyer" },
    accessToken: "access",
    unauthorized: null,
  });
  mocks.getTradeRoomData.mockResolvedValue(room());
  mocks.checkSharedRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, reason: null });
  mocks.prepareTradeRoomConversationEmail.mockResolvedValue(async () => undefined);
  mocks.postTradeRoomMessage.mockResolvedValue({
    message: {
      id: "private-message-id",
      purchaseRequestId: "purchase-1",
      kind: "user",
      senderUserId: "buyer-1",
      senderRole: "buyer",
      message: "Payment is ready",
      createdAt: "2026-09-06T13:00:00.000Z",
      readByUserIds: ["buyer-1"],
    },
    created: true,
    notificationRecipientUserId: "private-seller-id",
    senderParticipantRole: "buyer",
    trade: { id: "purchase-1", tradeId: "TR-12" },
    metrics: { totalMs: 1, readDbMs: 0, validationMs: 0, businessMs: 0, writeDbMs: 1, sseMs: 0 },
  });
});

describe("mobile Trade Room message route", () => {
  it("derives sender identity, ignores forged media fields, and returns a whitelist projection", async () => {
    const response = await POST(request({
      message: "Payment is ready",
      clientMessageId,
      senderUserId: "private-seller-id",
      imageUrl: "data:image/jpeg;base64,private",
      imageName: "050-000-0000.jpg",
    }), context());
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      message: { sender: "you", message: "Payment is ready" },
      created: true,
    });
    expect(mocks.postTradeRoomMessage).toHaveBeenCalledWith({
      purchaseRequestId: "purchase-1",
      actorUserId: "buyer-1",
      message: "Payment is ready",
      clientMessageId,
    });
    expect(serialized).not.toContain("private-message-id");
    expect(serialized).not.toContain("private-seller-id");
    expect(serialized).not.toContain("050-000-0000");
  });

  it("conceals a trade from a privileged account that is not a participant", async () => {
    mocks.requireMobileApiUser.mockResolvedValueOnce({
      user: { id: "owner-1", role: "owner" },
      accessToken: "access",
      unauthorized: null,
    });

    const response = await POST(request({ message: "Hello", clientMessageId }), context());

    expect(response.status).toBe(404);
    expect(mocks.postTradeRoomMessage).not.toHaveBeenCalled();
  });

  it("returns a stable localized error when direct contact content is blocked", async () => {
    mocks.postTradeRoomMessage.mockRejectedValueOnce(new Error(DIRECT_CONTACT_CONTENT_ERROR));

    const response = await POST(request({ message: "اتصل بي", clientMessageId }, "ar"), context());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("DIRECT_CONTACT_BLOCKED");
    expect(payload.error.message).toContain("غرفة الصفقة");
  });

  it("uses the client id for exact-once replay and suppresses duplicate email delivery", async () => {
    mocks.postTradeRoomMessage.mockResolvedValueOnce({
      message: {
        id: "private-message-id",
        purchaseRequestId: "purchase-1",
        kind: "user",
        senderUserId: "buyer-1",
        senderRole: "buyer",
        message: "Payment is ready",
        createdAt: "2026-09-06T13:00:00.000Z",
        readByUserIds: ["buyer-1"],
      },
      created: false,
      notificationRecipientUserId: "private-seller-id",
      senderParticipantRole: "buyer",
      trade: { id: "purchase-1", tradeId: "TR-12" },
      metrics: { totalMs: 1 },
    });

    const response = await POST(request({ message: "Payment is ready", clientMessageId }), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Trade-Message-Replayed")).toBe("1");
    expect(mocks.prepareTradeRoomConversationEmail).not.toHaveBeenCalled();
  });

  it("keeps infrastructure error codes behind the service-unavailable boundary", async () => {
    mocks.postTradeRoomMessage.mockRejectedValueOnce(Object.assign(new Error("database unavailable"), { code: "42P01" }));

    const response = await POST(request({ message: "Hello", clientMessageId }), context());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "SERVICE_UNAVAILABLE" } });
  });
});
