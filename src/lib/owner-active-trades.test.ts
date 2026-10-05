import { describe, expect, it } from "vitest";
import { buildOwnerActiveTradeSummaries } from "./owner-active-trades";
import type { AlphaExchangeUser, PurchaseRequest } from "@/types/alpha-exchange";

const users = [
  { id: "owner", role: "owner", fullName: "Owner" },
  { id: "buyer", role: "buyer", fullName: "Buyer Full Name" },
  { id: "seller", role: "approved_seller", fullName: "Seller Full Name" },
  { id: "admin", role: "admin", fullName: "Admin" },
] as AlphaExchangeUser[];
const trade = (id: string, status: PurchaseRequest["status"], updatedAt = "2026-10-05T11:00:00Z") => ({
  id, status, updatedAt, buyerId: "buyer", sellerId: "seller", buyerName: "Legacy Buyer",
  usdtAmount: "1000", fiatAmount: "3270", currency: "ILS", paymentMethod: "Bank Transfer",
  buyerReceivingWalletAddress: "private-wallet", sellerBankAccountSnapshot: { accountNumber: "private-account" },
  messages: [{ message: "private-chat" }],
} as PurchaseRequest);

describe("owner active trade summaries", () => {
  it("includes every active trade, newest first, with both canonical names", () => {
    const result = buildOwnerActiveTradeSummaries([
      trade("older", "payment_sent"), trade("newer", "accepted", "2026-10-05T11:03:00Z"),
      trade("cash", "funds_received"), trade("sending", "usdt_release_pending"), trade("sent", "usdt_sent"),
      ...(["pending", "completed", "review_open", "locked", "cancelled", "declined"] as const).map(status => trade(status, status)),
    ], users, "owner");
    expect(result.map(item => item.id)).toEqual(["newer", "cash", "older", "sending", "sent"]);
    expect(result[0].buyerName).toContain("Buyer Full Name");
    expect(result[0].sellerName).toContain("Seller Full Name");
    expect(result[0].buyerName).toContain("AT-");
    expect(result[0]).toMatchObject({ usdtAmount: "1000", fiatAmount: "3270" });
    expect(JSON.stringify(result)).not.toMatch(/private-wallet|private-account|private-chat/);
    expect(Object.keys(result[0]).sort()).toEqual([
      "id", "tradeId", "displayNumber", "status", "usdtAmount", "fiatAmount", "currency", "paymentMethod", "updatedAt", "buyerName", "sellerName",
    ].sort());
  });

  it.each(["buyer", "seller", "admin", "missing"])("never provides the owner view to %s", actor => {
    expect(buildOwnerActiveTradeSummaries([trade("active", "accepted")], users, actor)).toEqual([]);
  });

  it("rejects a disabled owner and does not invent a missing seller's name", () => {
    expect(buildOwnerActiveTradeSummaries([trade("active", "accepted")], users.map(user => ({ ...user, disabled: true })), "owner")).toEqual([]);
    const [result] = buildOwnerActiveTradeSummaries([trade("active", "accepted")], users.filter(user => user.id !== "seller"), "owner");
    expect(result.sellerName).toMatch(/^AT-\d+$/);
  });
});
