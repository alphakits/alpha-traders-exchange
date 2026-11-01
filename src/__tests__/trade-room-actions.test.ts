import { describe, expect, it } from "vitest";
import {
  acquireTradeRoomMutation,
  canBuyerCancelTrade,
  canSellerCancelTrade,
  canSellerDeclineTrade,
  releaseTradeRoomMutation,
  tradeActionConfirmationKey,
} from "@/lib/trade-room-actions";
import type { PurchaseRequest } from "@/types/alpha-exchange";
import { areTradeAmountsLocked } from "@/lib/trade-amount-lock";

const request = {
  id: "request-1",
  buyerId: "buyer-1",
  sellerId: "seller-1",
  status: "pending",
} as PurchaseRequest;

describe("Trade Room secondary actions", () => {
  it("allows only one rapid Trade Room mutation and only its owner can release the lock", () => {
    const lock = { current: null as string | null };

    expect(acquireTradeRoomMutation(lock, "trade-1:pending:accepted")).toBe(true);
    expect(acquireTradeRoomMutation(lock, "trade-1:pending:declined")).toBe(false);
    expect(lock.current).toBe("trade-1:pending:accepted");

    releaseTradeRoomMutation(lock, "trade-1:pending:declined");
    expect(lock.current).toBe("trade-1:pending:accepted");

    releaseTradeRoomMutation(lock, "trade-1:pending:accepted");
    expect(lock.current).toBeNull();
    expect(acquireTradeRoomMutation(lock, "trade-1:cancel")).toBe(true);
  });

  it("allows the buyer to cancel until payment evidence is submitted", () => {
    expect(canBuyerCancelTrade(request, "buyer-1")).toBe(true);
    expect(canBuyerCancelTrade({ ...request, status: "accepted" }, "buyer-1")).toBe(true);
    expect(canBuyerCancelTrade({ ...request, status: "accepted", sensitivePaymentSharedAt: "2026-09-04T11:55:00.000Z", sensitivePaymentKind: "bank_details" }, "buyer-1")).toBe(false);
    expect(canBuyerCancelTrade({ ...request, status: "accepted", paymentSentAt: "2026-09-04T12:00:00.000Z" }, "buyer-1")).toBe(false);
    expect(canBuyerCancelTrade({ ...request, status: "accepted", buyerEvidence: { id: "evidence-1" } as never }, "buyer-1")).toBe(false);
    expect(canBuyerCancelTrade({ ...request, status: "payment_sent" }, "buyer-1")).toBe(false);
    expect(canBuyerCancelTrade(request, "seller-1")).toBe(false);
  });

  it("allows the seller to decline only a pending request", () => {
    expect(canSellerDeclineTrade(request, "seller-1")).toBe(true);
    expect(canSellerDeclineTrade({ ...request, status: "accepted" }, "seller-1")).toBe(false);
    expect(canSellerDeclineTrade(request, "buyer-1")).toBe(false);
  });

  it.each([
    ["buyer-1", false], ["", false], ["seller-1", true], ["owner-1", true], ["admin-1", true],
  ] as const)("uses the disclosure recipient %s for cancellation without locking unpaid amounts", (actorUserId, mayCancel) => {
    const viewed = { ...request, timeline: [{
      id: "view-1", type: "bank_details_revealed", actorUserId, actorRole: "buyer",
      message: "Trade bank details viewed", createdAt: "2026-10-16T12:00:00Z",
    }] } as PurchaseRequest;
    expect(canBuyerCancelTrade(viewed, "buyer-1")).toBe(mayCancel);
    expect(areTradeAmountsLocked(viewed)).toBe(false);
    expect(areTradeAmountsLocked({ ...viewed, status: "accepted" })).toBe(false);
    expect(canBuyerCancelTrade({ ...viewed, sensitivePaymentKind: "bank_details", sensitivePaymentSharedAt: "2026-10-16T12:01:00Z" }, "buyer-1")).toBe(false);
  });

  it.each(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"])("allows seller cancellation before payment for %s", (paymentMethod) => {
    expect(canSellerCancelTrade({ ...request, paymentMethod }, "seller-1")).toBe(true);
    expect(canSellerCancelTrade({ ...request, paymentMethod, status: "accepted" }, "seller-1")).toBe(true);
    expect(canSellerCancelTrade({ ...request, paymentMethod, status: "accepted" }, "buyer-1")).toBe(false);
    expect(canSellerCancelTrade({ ...request, paymentMethod, status: "accepted" }, "outsider")).toBe(false);
  });

  it.each([
    { paymentSentAt: "2026-09-22T12:00:00Z" },
    { fundsReceivedAt: "2026-09-22T12:00:00Z" },
    { usdtReleaseStartedAt: "2026-09-22T12:00:00Z" },
    { usdtSentAt: "2026-09-22T12:00:00Z" },
    { buyerEvidence: { id: "buyer-proof" } },
    { sellerEvidence: { id: "seller-proof" } },
    { sensitivePaymentKind: "cardless_code", sensitivePaymentSharedAt: "2026-09-22T12:00:00Z" },
    { messages: [{ credentialKind: "cardless_code" }] },
  ] as Partial<PurchaseRequest>[])("blocks both participants when a stale accepted request has progress: %j", (progress) => {
    const stale = { ...request, status: "accepted" as const, ...progress };
    expect(canSellerCancelTrade(stale, "seller-1")).toBe(false);
    expect(canBuyerCancelTrade(stale, "buyer-1")).toBe(false);
    if (!progress.messages) expect(canSellerDeclineTrade({ ...stale, status: "pending" }, "seller-1")).toBe(false);
  });

  it("keeps seller cancellation available after bank account details are revealed", () => {
    expect(canSellerCancelTrade({ ...request, status: "accepted", sensitivePaymentKind: "bank_details", sensitivePaymentSharedAt: "2026-09-22T12:00:00Z" }, "seller-1")).toBe(true);
  });

  it("allows cancelling a pending cardless request with a prepared, undisclosed code", () => {
    const prepared = { ...request, paymentMethod: "Cardless ATM Withdrawal", messages: [{ credentialKind: "cardless_code" }] } as PurchaseRequest;
    expect(canSellerDeclineTrade(prepared, "seller-1")).toBe(true);
    expect(canBuyerCancelTrade(prepared, "buyer-1")).toBe(true);
  });
});

describe("trade action consent", () => {
  const confirmedRequest: PurchaseRequest = {
    ...request,
    listingId: "listing-1",
    buyerName: "Buyer One",
    usdtAmount: "327.059733",
    fiatAmount: "1100",
    pricePerUsdt: "3.33",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Cardless ATM Withdrawal",
    feePolicyVersion: "buyer_seller_1pct_v1",
    buyerReceivingWalletAddress: "buyer-wallet-1",
    timeline: [],
    createdAt: "2026-10-29T10:00:00Z",
    updatedAt: "2026-10-29T10:00:00Z",
  };

  it.each([
    ["the agreed amount changes", { usdtAmount: "356.792050", fiatAmount: "1200" }],
    ["the agreed price changes", { pricePerUsdt: "3.30" }],
    ["the receiving wallet changes", { buyerReceivingWalletAddress: "buyer-wallet-2" }],
    ["the payment route changes", { paymentMethod: "Bank Transfer", bankName: "A bank", sellerBankAccountId: "account-1" }],
    ["the buyer changes", { buyerId: "buyer-2" }],
    ["a new amount proposal arrives", { termsProposal: {
      id: "proposal-1", kind: "amount_correction", status: "pending",
      usdtAmount: "356.792050", fiatAmount: "1200", pricePerUsdt: "3.33", createdAt: "2026-10-29T10:01:00Z",
    } }],
  ] satisfies Array<[string, Partial<PurchaseRequest>]>)("requires fresh consent when %s", (_, changed) => {
    expect(tradeActionConfirmationKey({ ...confirmedRequest, ...changed }))
      .not.toBe(tradeActionConfirmationKey(confirmedRequest));
  });

  it("keeps consent valid when chat and read receipts refresh without changing the trade", () => {
    const refreshed: PurchaseRequest = {
      ...confirmedRequest,
      updatedAt: "2026-10-29T10:02:00Z",
      messages: [{
        id: "message-1", purchaseRequestId: confirmedRequest.id, kind: "user",
        senderUserId: confirmedRequest.buyerId, senderRole: "buyer", message: "I am ready.",
        createdAt: "2026-10-29T10:01:00Z", seenAt: "2026-10-29T10:02:00Z",
        readByUserIds: [confirmedRequest.buyerId, confirmedRequest.sellerId],
      }],
      pokeState: { buyerToSellerAt: "2026-10-29T10:01:30Z" },
    };
    expect(tradeActionConfirmationKey(refreshed)).toBe(tradeActionConfirmationKey(confirmedRequest));
  });

  it.each([
    { paymentSentAt: "2026-10-29T10:02:00Z" },
    { sensitivePaymentKind: "cardless_code", sensitivePaymentSharedAt: "2026-10-29T10:02:00Z" },
    { sensitivePaymentKind: "bank_details", sensitivePaymentSharedAt: "2026-10-29T10:02:00Z" },
  ] satisfies Partial<PurchaseRequest>[])("invalidates consent for payment progress even when status is stale: %j", (progress) => {
    const accepted: PurchaseRequest = { ...confirmedRequest, status: "accepted" };
    expect(tradeActionConfirmationKey({ ...accepted, ...progress }))
      .not.toBe(tradeActionConfirmationKey(accepted));
  });

  it("keeps a prepared ATM credential private until the buyer confirms, then invalidates earlier consent", () => {
    const prepared: PurchaseRequest = {
      ...confirmedRequest,
      status: "accepted",
      cardlessCodeAwaitingBuyerConfirmation: true,
      messages: [{
        id: "credential-1", purchaseRequestId: confirmedRequest.id, kind: "user",
        senderUserId: confirmedRequest.buyerId, senderRole: "buyer", message: "[Private payment details]",
        credentialKind: "cardless_code", confidential: true,
        createdAt: "2026-10-29T10:01:00Z", readByUserIds: [confirmedRequest.buyerId],
      }],
    };
    expect(tradeActionConfirmationKey({ ...prepared, updatedAt: "2026-10-29T10:03:00Z" }))
      .toBe(tradeActionConfirmationKey(prepared));
    expect(tradeActionConfirmationKey({ ...prepared, cardlessCodeAwaitingBuyerConfirmation: false }))
      .not.toBe(tradeActionConfirmationKey(prepared));
  });
});
