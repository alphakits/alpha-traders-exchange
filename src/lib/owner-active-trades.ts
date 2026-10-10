import { isPublicOwnerIdentity, ownerAccountName } from "@/lib/public-account-identity";
import type { AlphaExchangeUser, PurchaseRequest } from "@/types/alpha-exchange";

export type OwnerActiveTradeSummary = Pick<PurchaseRequest,
  "id" | "tradeId" | "displayNumber" | "status" | "usdtAmount" | "fiatAmount" | "currency" | "paymentMethod" | "updatedAt"
> & { buyerName: string; sellerName: string };

const activeStatuses = new Set<PurchaseRequest["status"]>([
  "accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent",
]);

export function isActiveOwnerTrade(request: Pick<PurchaseRequest, "status">) {
  return activeStatuses.has(request.status);
}

/** Explicit projection: private identities are only for a canonical owner. */
export function buildOwnerActiveTradeSummaries(
  requests: readonly PurchaseRequest[], users: readonly AlphaExchangeUser[], ownerId: string,
): OwnerActiveTradeSummary[] {
  const accounts = new Map(users.map(user => [user.id, user]));
  if (!isPublicOwnerIdentity(accounts.get(ownerId))) return [];
  return requests.filter(isActiveOwnerTrade)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id))
    .map(request => ({
      id: request.id, tradeId: request.tradeId, displayNumber: request.displayNumber,
      status: request.status, usdtAmount: request.usdtAmount, fiatAmount: request.fiatAmount,
      currency: request.currency, paymentMethod: request.paymentMethod, updatedAt: request.updatedAt,
      buyerName: ownerAccountName(accounts.get(request.buyerId) ?? { id: request.buyerId, fullName: request.buyerName }),
      sellerName: ownerAccountName(accounts.get(request.sellerId) ?? { id: request.sellerId }),
    }));
}
