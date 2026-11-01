import type { AlphaExchangeUser, PurchaseRequest } from "@/types/alpha-exchange";
import { publicAccountName } from "@/lib/public-account-identity";
import { getTradeHeaderReminderKind, toTradeHeaderActivity } from "@/lib/trade-header-activity";
import type { OwnerActiveTradeSummary } from "@/lib/owner-active-trades";

export type SellerActiveTradeSummary = OwnerActiveTradeSummary & {
  perspective: "seller" | "buyer";
  actionRequired: boolean;
};

/** Navigation access survives suspension so existing trades remain reachable. */
export function usesSellerActiveTradeHeader(user?: {
  role: string; roles?: readonly string[]; sellerStatus?: string; disabled?: boolean;
} | null) {
  return Boolean(user && !user.disabled && (user.sellerStatus === "approved_seller"
    || user.sellerStatus === "suspended" || user.role === "approved_seller"
    || user.roles?.includes("approved_seller")));
}

const activeStatuses = new Set<PurchaseRequest["status"]>([
  "accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent",
]);

/** Explicit participant-only projection. Never include owner-only names or payment credentials. */
export function buildSellerActiveTradeSummaries(
  requests: readonly PurchaseRequest[], users: readonly AlphaExchangeUser[], actorId: string,
): SellerActiveTradeSummary[] {
  const accounts = new Map(users.map(user => [user.id, user]));
  if (!usesSellerActiveTradeHeader(accounts.get(actorId))) return [];
  return requests.filter(request => (request.sellerId === actorId || request.buyerId === actorId)
    && (activeStatuses.has(request.status) || (request.status === "pending" && request.buyerId === actorId)))
    // Stable positions while stages update: oldest trade first, new trades at the bottom.
    .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)
      || a.id.localeCompare(b.id))
    .map(request => ({
      id: request.id, tradeId: request.tradeId, displayNumber: request.displayNumber,
      status: request.status, usdtAmount: request.usdtAmount, fiatAmount: request.fiatAmount,
      currency: request.currency, paymentMethod: request.paymentMethod, updatedAt: request.updatedAt,
      buyerName: publicAccountName(accounts.get(request.buyerId) ?? { id: request.buyerId }),
      sellerName: publicAccountName(accounts.get(request.sellerId) ?? { id: request.sellerId }),
      perspective: request.sellerId === actorId ? "seller" : "buyer",
      actionRequired: getTradeHeaderReminderKind(toTradeHeaderActivity(request), actorId) !== null,
    }));
}
