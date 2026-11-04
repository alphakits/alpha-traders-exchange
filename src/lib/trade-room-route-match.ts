/** Match only the same canonical room using the server-supported purchase-prefix and trade-ID aliases. */
export function matchesTradeRoomRoute(request: { id: string; tradeId?: string }, routeId: string): boolean {
  const normalized = routeId.trim();
  if (!normalized) return false;
  const alternate = normalized.startsWith("purchase-")
    ? normalized.slice("purchase-".length) : `purchase-${normalized}`;
  const candidates = [normalized, alternate].filter(Boolean);
  return candidates.includes(request.id) || Boolean(request.tradeId && candidates.includes(request.tradeId));
}
