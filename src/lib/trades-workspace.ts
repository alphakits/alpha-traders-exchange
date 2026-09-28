import type { PurchaseRequest } from "@/types/alpha-exchange";

export type TradeWorkspaceSide = "buyer" | "seller";
export function groupOwnTrades(requests: readonly PurchaseRequest[], userId: string, side: TradeWorkspaceSide) {
  const own = requests.filter(request => (side === "seller" ? request.sellerId : request.buyerId) === userId);
  const completed = (request: PurchaseRequest) => ["completed", "review_open", "locked"].includes(request.status) || Boolean(request.completedAt);
  const closed = (request: PurchaseRequest) => ["cancelled", "declined"].includes(request.status);
  const time = (value?: string) => Date.parse(value ?? "") || 0;
  return {
    active: own.filter(request => !completed(request) && !closed(request)).sort((a, b) => time(b.createdAt) - time(a.createdAt) || b.id.localeCompare(a.id)),
    completed: own.filter(completed).sort((a, b) => time(b.completedAt ?? b.updatedAt ?? b.createdAt) - time(a.completedAt ?? a.updatedAt ?? a.createdAt) || b.id.localeCompare(a.id)),
    closed: own.filter(request => closed(request) && !completed(request)).sort((a, b) => time(b.updatedAt ?? b.createdAt) - time(a.updatedAt ?? a.createdAt)),
  };
}
