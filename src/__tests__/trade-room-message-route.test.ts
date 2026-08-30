import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  checkSharedRateLimit: vi.fn(),
  getTradeRoomData: vi.fn(),
  logEvent: vi.fn(),
  postTradeRoomMessage: vi.fn(),
  prepareTradeRoomConversationEmail: vi.fn(),
  requireApiUser: vi.fn(),
  requireEmailVerificationForTrading: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: mocks.after };
});

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
  requireEmailVerificationForTrading: mocks.requireEmailVerificationForTrading,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  getTradeRoomData: mocks.getTradeRoomData,
  postTradeRoomMessage: mocks.postTradeRoomMessage,
}));

vi.mock("@/lib/marketplace-email-events", () => ({
  TRADE_ROOM_MESSAGE_EMAIL_BURST_WINDOW_MS: 120_000,
  prepareTradeRoomConversationEmail: mocks.prepareTradeRoomConversationEmail,
}));

vi.mock("@/lib/structured-logging", () => ({
  logEvent: mocks.logEvent,
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/alpha-exchange/purchase-requests/[requestId]/messages/route";
import { DIRECT_CONTACT_CONTENT_ERROR } from "@/lib/privacy-redaction";

const deliverEmail = async () => {};

function createMessageRequest(message = "A private chat message", requestId = "purchase-1", clientMessageId = "4f4779eb-cb34-4d4b-b729-69d03d6e1381") {
  return new NextRequest(`http://localhost/api/alpha-exchange/purchase-requests/${requestId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, clientMessageId }),
  });
}

function routeContext(requestId = "purchase-1") {
  return { params: Promise.resolve({ requestId }) };
}

describe("Trade Room message email scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({
      user: { id: "buyer-1", role: "buyer", emailVerified: true },
      unauthorized: null,
    });
    mocks.postTradeRoomMessage.mockResolvedValue({
      message: { id: "message-1" },
      created: true,
      notificationRecipientUserId: "seller-1",
      senderParticipantRole: "buyer",
      trade: { id: "purchase-1", tradeId: "TR-100" },
      metrics: { totalMs: 1, readDbMs: 0, validationMs: 0, businessMs: 0, writeDbMs: 1, sseMs: 0 },
    });
    mocks.prepareTradeRoomConversationEmail.mockResolvedValue(deliverEmail);
    mocks.after.mockImplementation(() => undefined);
    mocks.requireEmailVerificationForTrading.mockReturnValue(null);
  });

  it("schedules only the first recipient/trade message email in the server-owned two-minute burst", async () => {
    mocks.checkSharedRateLimit
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0, reason: null })
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0, reason: null })
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0, reason: null })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 119, reason: "limit_reached" });

    const first = await POST(createMessageRequest(), routeContext());
    const second = await POST(createMessageRequest("Another private message"), routeContext());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(mocks.prepareTradeRoomConversationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.prepareTradeRoomConversationEmail).toHaveBeenCalledWith({
      event: "trade_room_message",
      request: { id: "purchase-1", tradeId: "TR-100" },
      recipientUserId: "seller-1",
      senderUserId: "buyer-1",
      senderRole: "buyer",
      idempotencyKey: "trade-room-message:message-1:seller-1",
    });
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.checkSharedRateLimit).toHaveBeenLastCalledWith(expect.objectContaining({
      key: "exchange:trade-room-message-email",
      identifier: "purchase-1:seller-1",
      maxRequests: 1,
      windowMs: 120_000,
    }));
  });

  it("does not roll back a persisted message when preparing the email fails", async () => {
    mocks.checkSharedRateLimit
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0, reason: null })
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0, reason: null });
    mocks.prepareTradeRoomConversationEmail.mockRejectedValueOnce(new Error("email provider unavailable"));

    const response = await POST(createMessageRequest(), routeContext());

    expect(response.status).toBe(201);
    expect(mocks.postTradeRoomMessage).toHaveBeenCalledTimes(1);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.logEvent).toHaveBeenCalledWith("error", expect.objectContaining({
      event: "trade_room_email_schedule",
      reason: "post_commit_schedule_failed",
    }));
  });

  it("isolates the email burst by canonical trade and recipient", async () => {
    mocks.requireApiUser
      .mockResolvedValueOnce({ user: { id: "buyer-1", role: "buyer", emailVerified: true }, unauthorized: null })
      .mockResolvedValueOnce({ user: { id: "buyer-1", role: "buyer", emailVerified: true }, unauthorized: null })
      .mockResolvedValueOnce({ user: { id: "buyer-1", role: "buyer", emailVerified: true }, unauthorized: null })
      .mockResolvedValueOnce({ user: { id: "seller-1", role: "approved_seller", emailVerified: true }, unauthorized: null });
    mocks.postTradeRoomMessage
      .mockReset()
      .mockResolvedValueOnce({
        message: { id: "message-a1" }, created: true, notificationRecipientUserId: "seller-1", senderParticipantRole: "buyer",
        trade: { id: "trade-a", tradeId: "TR-A" }, metrics: { totalMs: 1, readDbMs: 0, validationMs: 0, businessMs: 0, writeDbMs: 1, sseMs: 0 },
      })
      .mockResolvedValueOnce({
        message: { id: "message-a2" }, created: true, notificationRecipientUserId: "seller-1", senderParticipantRole: "buyer",
        trade: { id: "trade-a", tradeId: "TR-A" }, metrics: { totalMs: 1, readDbMs: 0, validationMs: 0, businessMs: 0, writeDbMs: 1, sseMs: 0 },
      })
      .mockResolvedValueOnce({
        message: { id: "message-b1" }, created: true, notificationRecipientUserId: "seller-1", senderParticipantRole: "buyer",
        trade: { id: "trade-b", tradeId: "TR-B" }, metrics: { totalMs: 1, readDbMs: 0, validationMs: 0, businessMs: 0, writeDbMs: 1, sseMs: 0 },
      })
      .mockResolvedValueOnce({
        message: { id: "message-a3" }, created: true, notificationRecipientUserId: "buyer-1", senderParticipantRole: "seller",
        trade: { id: "trade-a", tradeId: "TR-A" }, metrics: { totalMs: 1, readDbMs: 0, validationMs: 0, businessMs: 0, writeDbMs: 1, sseMs: 0 },
      });
    let emailBurstAttempt = 0;
    mocks.checkSharedRateLimit.mockImplementation(async (input: { key?: string }) => {
      if (input.key !== "exchange:trade-room-message-email") {
        return { allowed: true, retryAfterSeconds: 0, reason: null };
      }
      emailBurstAttempt += 1;
      return emailBurstAttempt === 2
        ? { allowed: false, retryAfterSeconds: 119, reason: "limit_reached" }
        : { allowed: true, retryAfterSeconds: 0, reason: null };
    });

    await POST(createMessageRequest("first", "trade-a"), routeContext("trade-a"));
    await POST(createMessageRequest("rapid", "trade-a"), routeContext("trade-a"));
    await POST(createMessageRequest("other trade", "trade-b"), routeContext("trade-b"));
    await POST(createMessageRequest("reverse", "trade-a"), routeContext("trade-a"));

    expect(mocks.prepareTradeRoomConversationEmail).toHaveBeenCalledTimes(3);
    const emailBurstKeys = mocks.checkSharedRateLimit.mock.calls
      .map(([input]) => input as { key?: string; identifier?: string })
      .filter((input) => input.key === "exchange:trade-room-message-email")
      .map((input) => input.identifier);
    expect(emailBurstKeys).toEqual([
      "trade-a:seller-1",
      "trade-a:seller-1",
      "trade-b:seller-1",
      "trade-a:buyer-1",
    ]);
  });

  it("denies an unverified email before reading or sending a Trade Room message", async () => {
    mocks.requireEmailVerificationForTrading.mockReturnValueOnce(new Response(null, { status: 403 }));
    const response = await POST(createMessageRequest(), routeContext());
    expect(response.status).toBe(403);
    expect(mocks.postTradeRoomMessage).not.toHaveBeenCalled();
  });

  it("forwards the stable client message id used for exact-once retries", async () => {
    mocks.checkSharedRateLimit
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0, reason: null })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 119, reason: "limit_reached" });
    const clientMessageId = "ad0bdb49-b5ca-443e-aeda-2318f716c654";

    const response = await POST(createMessageRequest("Still here", "purchase-1", clientMessageId), routeContext());

    expect(response.status).toBe(201);
    expect(mocks.postTradeRoomMessage).toHaveBeenCalledWith(expect.objectContaining({ clientMessageId }));
  });

  it("returns a stable policy code so blocked contact details are explained inline", async () => {
    mocks.checkSharedRateLimit.mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0, reason: null });
    mocks.postTradeRoomMessage.mockRejectedValueOnce(new Error(DIRECT_CONTACT_CONTENT_ERROR));

    const response = await POST(createMessageRequest("050-123-4567"), routeContext());
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: DIRECT_CONTACT_CONTENT_ERROR, code: "DIRECT_CONTACT_BLOCKED" });
  });

  it("does not schedule a second email when a retry replays an already-committed message", async () => {
    mocks.checkSharedRateLimit.mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0, reason: null });
    mocks.postTradeRoomMessage.mockResolvedValueOnce({
      message: { id: "message-1" },
      created: false,
      notificationRecipientUserId: "seller-1",
      senderParticipantRole: "buyer",
      trade: { id: "purchase-1", tradeId: "TR-100" },
      metrics: { totalMs: 1, readDbMs: 0, validationMs: 0, businessMs: 0, writeDbMs: 1, sseMs: 0 },
    });

    const response = await POST(createMessageRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Trade-Message-Replayed")).toBe("1");
    expect(mocks.prepareTradeRoomConversationEmail).not.toHaveBeenCalled();
  });
});
