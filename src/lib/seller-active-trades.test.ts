import { describe, expect, it } from "vitest";
import { buildSellerActiveTradeSummaries } from "./seller-active-trades";
import type { AlphaExchangeUser, PurchaseRequest } from "@/types/alpha-exchange";

const users = [
  { id: "seller", role: "approved_seller", sellerStatus: "approved_seller", fullName: "Private Seller" },
  { id: "buyer-1", role: "buyer", fullName: "Private Buyer One" },
  { id: "buyer-2", role: "buyer", fullName: "Private Buyer Two" },
] as AlphaExchangeUser[];
const trade = (id: string, status: PurchaseRequest["status"], overrides: Partial<PurchaseRequest> = {}) => ({
  id, status, buyerId: "buyer-1", sellerId: "seller", buyerName: "Private Buyer One",
  createdAt: "2026-10-06T11:00:00Z", updatedAt: "2026-10-06T11:00:00Z",
  usdtAmount: "200", fiatAmount: "700", currency: "ILS", paymentMethod: "Bank Transfer",
  buyerReceivingWalletAddress: "private-wallet", sellerBankAccountSnapshot: { accountNumber: "private-bank" },
  messages: [{ message: "private-chat" }], ...overrides,
} as PurchaseRequest);

describe("seller active trade projection", () => {
  it("returns all three owned active trades in stable order despite stage updates", () => {
    const requests = [
      trade("three", "usdt_release_pending", { createdAt: "2026-10-06T11:03:00Z" }),
      trade("one", "accepted", { updatedAt: "2026-10-06T11:04:00Z" }),
      trade("two", "payment_sent", { createdAt: "2026-10-06T11:02:00Z", buyerId: "buyer-2" }),
      trade("other-seller", "accepted", { sellerId: "other" }),
      ...(["pending", "completed", "review_open", "locked", "cancelled", "declined"] as const).map(status => trade(status, status)),
    ];
    const result = buildSellerActiveTradeSummaries(requests, users, "seller");
    expect(result.map(item => item.id)).toEqual(["one", "two", "three"]);
    expect(result.map(item => item.actionRequired)).toEqual([false, true, true]);
    expect(result.every(item => item.perspective === "seller")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/Private|private-|wallet|BankAccount|messages/);
    expect(result[0].buyerName).toMatch(/^AT-\d+$/);
    expect(result[1].buyerName).not.toBe(result[0].buyerName);
    expect(requests[0].id).toBe("three");
  });
  it("preserves the seller's own buying trades, including a pending purchase", () => {
    const result = buildSellerActiveTradeSummaries([
      trade("buying", "accepted", { buyerId: "seller", sellerId: "other" }),
      trade("waiting", "pending", { buyerId: "seller", sellerId: "other" }),
      trade("unrelated", "payment_sent", { sellerId: "other" }),
    ], users, "seller");
    expect(result.map(item => item.id)).toEqual(["buying", "waiting"]);
    expect(result.map(item => item.perspective)).toEqual(["buyer", "buyer"]);
    expect(result.map(item => item.actionRequired)).toEqual([true, false]);
  });
  it("keeps existing trades available to suspended sellers, but rejects disabled or unrelated actors", () => {
    const suspended = users.map(user => user.id === "seller" ? { ...user, role: "buyer" as const, sellerStatus: "suspended" as const } : user);
    expect(buildSellerActiveTradeSummaries([trade("one", "accepted")], suspended, "seller")).toHaveLength(1);
    expect(buildSellerActiveTradeSummaries([trade("one", "accepted")], users.map(user => ({ ...user, disabled: true })), "seller")).toEqual([]);
    for (const id of ["buyer-1", "missing"]) expect(buildSellerActiveTradeSummaries([trade("one", "accepted")], users, id)).toEqual([]);
  });
  it.each(["Face-to-Face (Meet in Person)", "Cardless ATM Withdrawal"])("uses the existing %s action rules", paymentMethod => {
    const result = buildSellerActiveTradeSummaries([trade("cash", "usdt_sent", { paymentMethod })], users, "seller");
    expect(result[0].actionRequired).toBe(true);
  });
});
