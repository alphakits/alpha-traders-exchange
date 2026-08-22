import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TestTradeRoomPokeError extends Error {
    readonly code: string;
    readonly status: number;
    readonly retryAfterSeconds?: number;
    readonly cooldownUntil?: string | null;

    constructor(input: { code: string; message: string; status: number; retryAfterSeconds?: number; cooldownUntil?: string | null }) {
      super(input.message);
      this.code = input.code;
      this.status = input.status;
      this.retryAfterSeconds = input.retryAfterSeconds;
      this.cooldownUntil = input.cooldownUntil;
    }
  }
  return {
    after: vi.fn(),
    logEvent: vi.fn(),
    postTradeRoomPoke: vi.fn(),
    prepareTradeRoomConversationEmail: vi.fn(),
    requireApiUser: vi.fn(),
    TradeRoomPokeError: TestTradeRoomPokeError,
  };
});

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: mocks.after };
});

vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser,
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  postTradeRoomPoke: mocks.postTradeRoomPoke,
  TradeRoomPokeError: mocks.TradeRoomPokeError,
}));

vi.mock("@/lib/marketplace-email-events", () => ({
  prepareTradeRoomConversationEmail: mocks.prepareTradeRoomConversationEmail,
}));

vi.mock("@/lib/structured-logging", () => ({
  logEvent: mocks.logEvent,
}));

import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/alpha-exchange/purchase-requests/[requestId]/poke/route";

const deliverEmail = async () => {};

function request(body?: unknown) {
  return new NextRequest("http://localhost/api/alpha-exchange/purchase-requests/purchase-1/poke", {
    method: "POST",
    ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
}

function context() {
  return { params: Promise.resolve({ requestId: "purchase-1" }) };
}

describe("Trade Room Poke route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({ user: { id: "buyer-1", role: "buyer" }, unauthorized: null });
    mocks.postTradeRoomPoke.mockResolvedValue({
      message: { id: "poke-message-1" },
      poke: { available: true, canPoke: false, cooldownUntil: "2026-08-22T10:05:00.000Z", cooldownRemainingSeconds: 300, counterpartRole: "seller" },
      notificationRecipientUserId: "seller-1",
      senderParticipantRole: "buyer",
      trade: { id: "purchase-1", tradeId: "TR-100" },
    });
    mocks.prepareTradeRoomConversationEmail.mockResolvedValue(deliverEmail);
  });

  it("derives the actor and recipient entirely from the authenticated server session", async () => {
    const response = await POST(request({ actorUserId: "attacker", recipientUserId: "victim", role: "admin" }), context());

    expect(response.status).toBe(201);
    expect(mocks.postTradeRoomPoke).toHaveBeenCalledWith(expect.objectContaining({
      purchaseRequestId: "purchase-1",
      actorUserId: "buyer-1",
    }));
    expect(mocks.postTradeRoomPoke.mock.calls[0]?.[0]).not.toHaveProperty("recipientUserId");
    expect(mocks.postTradeRoomPoke.mock.calls[0]?.[0]).not.toHaveProperty("role");
    expect(mocks.prepareTradeRoomConversationEmail).toHaveBeenCalledWith({
      event: "trade_room_poke",
      request: { id: "purchase-1", tradeId: "TR-100" },
      recipientUserId: "seller-1",
      senderUserId: "buyer-1",
      senderRole: "buyer",
      idempotencyKey: "trade-room-poke:poke-message-1:seller-1",
    });
    expect(mocks.prepareTradeRoomConversationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.after).toHaveBeenCalledWith(deliverEmail);
  });

  it("returns the server cooldown status and retry data without another notification attempt", async () => {
    mocks.postTradeRoomPoke.mockRejectedValueOnce(new mocks.TradeRoomPokeError({
      code: "POKE_COOLDOWN_ACTIVE",
      message: "Please wait before sending another reminder for this trade.",
      status: 429,
      retryAfterSeconds: 299,
      cooldownUntil: "2026-08-22T10:05:00.000Z",
    }));

    const response = await POST(request(), context());
    const payload = await response.json() as { code?: string; cooldownUntil?: string };

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("299");
    expect(payload).toEqual(expect.objectContaining({
      code: "POKE_COOLDOWN_ACTIVE",
      cooldownUntil: "2026-08-22T10:05:00.000Z",
    }));
    expect(mocks.prepareTradeRoomConversationEmail).not.toHaveBeenCalled();
  });

  it("returns the existing unauthorized response before accepting any Poke input", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mocks.requireApiUser.mockResolvedValueOnce({ user: null, unauthorized });

    const response = await POST(request({ recipientUserId: "seller-1" }), context());

    expect(response.status).toBe(401);
    expect(mocks.postTradeRoomPoke).not.toHaveBeenCalled();
  });
});
