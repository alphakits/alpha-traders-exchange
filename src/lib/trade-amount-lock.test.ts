import { describe, expect, it } from "vitest";
import { areTradeAmountsLocked } from "./trade-amount-lock";
import type { PurchaseRequest, TradeTimelineEventType } from "@/types/alpha-exchange";

const timestamp = "2026-10-28T12:00:00Z";
const request = {
  id: "request-amount-lock", buyerId: "buyer-1", sellerId: "seller-1",
  paymentMethod: "Bank Transfer", status: "pending", timeline: [],
} as unknown as PurchaseRequest;
const event = (type: TradeTimelineEventType) => ({
  id: `event-${type}`, type, actorUserId: "buyer-1", actorRole: "buyer" as const,
  message: "Recorded trade progress", createdAt: timestamp,
});

describe("payment boundary for trade amount proposals", () => {
  it.each(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"])(
    "keeps unpaid %s amounts editable after acceptance", paymentMethod => {
      for (const status of ["pending", "accepted"] as const) {
        expect(areTradeAmountsLocked({ ...request, paymentMethod, status,
          tradeCreatedAt: timestamp, priceOfferAcceptedAt: timestamp,
          timeline: [event("request_accepted"), event("price_offer_accepted")],
        })).toBe(false);
      }
    },
  );

  it("does not treat bank-detail disclosure as payment", () => {
    for (const status of ["pending", "accepted"] as const) {
      expect(areTradeAmountsLocked({ ...request, status, sensitivePaymentKind: "bank_details",
        sensitivePaymentSharedAt: timestamp, timeline: [event("bank_details_revealed")],
      })).toBe(false);
    }
  });

  it.each(["payment_sent", "funds_received", "usdt_release_pending", "usdt_sent", "completed", "locked", "review_open", "declined", "cancelled"] as const)(
    "locks amounts at the %s stage", status => expect(areTradeAmountsLocked({ ...request, status })).toBe(true),
  );

  it.each([
    { paymentSentAt: timestamp }, { fundsReceivedAt: timestamp },
    { usdtReleaseStartedAt: timestamp }, { usdtSentAt: timestamp }, { completedAt: timestamp },
    { lockedAt: timestamp }, { closedAt: timestamp }, { timedOutAt: timestamp },
    { buyerEvidence: { id: "buyer-receipt" } }, { sellerEvidence: { id: "seller-receipt" } },
    { sensitivePaymentKind: "cardless_code", sensitivePaymentSharedAt: timestamp },
  ] as Partial<PurchaseRequest>[])("retains durable progress despite a stale status: %j", progress => {
    for (const status of ["pending", "accepted"] as const) {
      expect(areTradeAmountsLocked({ ...request, ...progress, status })).toBe(true);
    }
  });

  it.each([
    "payment_sent", "seller_confirmed_funds", "buyer_confirmed_funds", "usdt_release_started",
    "usdt_sent", "trade_completed", "buyer_evidence_uploaded", "seller_evidence_uploaded",
    "trade_timed_out", "trade_locked", "request_declined", "price_offer_declined", "request_cancelled",
    "buyer_confirmed_receipt", "buyer_confirmation_overdue", "trade_closed_manually",
  ] as TradeTimelineEventType[])("retains historical %s despite a stale status", type => {
    for (const status of ["pending", "accepted"] as const) {
      expect(areTradeAmountsLocked({ ...request, status, timeline: [event(type)] })).toBe(true);
    }
  });

  it("allows prepared ATM credentials until disclosure and preserves legacy acceptance history", () => {
    const saved = { ...request, paymentMethod: "Cardless ATM Withdrawal",
      messages: [{ credentialKind: "cardless_code" }],
    } as PurchaseRequest;
    expect(areTradeAmountsLocked(saved)).toBe(false);
    expect(areTradeAmountsLocked({ ...saved, status: "accepted" })).toBe(true);
    expect(areTradeAmountsLocked({ ...saved, status: "accepted", cardlessCodeAwaitingBuyerConfirmation: true })).toBe(false);
    expect(areTradeAmountsLocked({ ...saved, timeline: [event("request_accepted")] })).toBe(true);
    expect(areTradeAmountsLocked({ ...saved, tradeCreatedAt: timestamp })).toBe(true);
    expect(areTradeAmountsLocked({ ...saved, tradeCreatedAt: timestamp, cardlessCodeAwaitingBuyerConfirmation: true })).toBe(false);
    expect(areTradeAmountsLocked({ ...saved, status: "accepted", cardlessCodeAwaitingBuyerConfirmation: true,
      sensitivePaymentKind: "cardless_code", sensitivePaymentSharedAt: timestamp,
    })).toBe(true);
  });

  it("does not reopen an unidentified legacy sensitive disclosure", () => {
    expect(areTradeAmountsLocked({ ...request, sensitivePaymentSharedAt: timestamp })).toBe(true);
  });
});
