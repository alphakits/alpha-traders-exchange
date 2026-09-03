import type { MarketplaceListing, PurchaseRequest, PurchaseRequestStatus } from "@/types/alpha-exchange";

export const STALE_PRICE_OFFER_MINUTES = 30;
export const STALLED_TRADE_AFTER_WARNING_MINUTES = 15;

const ACTIVE_TRADE_STATUSES = new Set<PurchaseRequestStatus>([
  "accepted",
  "payment_sent",
  "funds_received",
  "usdt_release_pending",
  "usdt_sent",
]);

const LOCKED_LISTING_STATUSES = new Set<MarketplaceListing["status"]>(["matched", "in_trade"]);

export type MarketplaceOperationalIncidentKind =
  | "overdue_usdt_release"
  | "stale_price_offer"
  | "stalled_trade"
  | "orphaned_listing_lock"
  | "unlinked_active_trade";

export type MarketplaceOperationalIncident = {
  id: string;
  kind: MarketplaceOperationalIncidentKind;
  severity: "warning" | "critical";
  requestId?: string;
  tradeId?: string;
  listingId?: string;
  status?: PurchaseRequestStatus;
  ageMinutes: number;
};

export type MarketplaceOperationalSnapshot = {
  status: "healthy" | "attention" | "critical";
  generatedAt: string;
  activeTrades: number;
  pendingPriceOffers: number;
  stalePriceOffers: number;
  stalledTrades: number;
  overdueUsdtReleases: number;
  dataIntegrityIssues: number;
  incidents: MarketplaceOperationalIncident[];
};

function toTimestamp(value?: string) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function ageMinutes(value: string | undefined, nowMs: number) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return 0;
  return Math.max(0, Math.floor((nowMs - timestamp) / 60_000));
}

export function buildMarketplaceOperationalSnapshot(
  input: {
    marketplaceListings: MarketplaceListing[];
    purchaseRequests: PurchaseRequest[];
  },
  now = new Date(),
): MarketplaceOperationalSnapshot {
  const nowMs = now.getTime();
  const requestsById = new Map(input.purchaseRequests.map((request) => [request.id, request]));
  const listingsById = new Map(input.marketplaceListings.map((listing) => [listing.id, listing]));
  const incidents: MarketplaceOperationalIncident[] = [];

  const activeTrades = input.purchaseRequests.filter((request) => ACTIVE_TRADE_STATUSES.has(request.status)).length;
  const pendingPriceOffers = input.purchaseRequests.filter(
    (request) => request.status === "pending" && request.priceMode === "buyer_offer",
  ).length;

  for (const request of input.purchaseRequests) {
    if (request.status === "pending" && request.priceMode === "buyer_offer") {
      const offerAgeMinutes = ageMinutes(request.createdAt, nowMs);
      if (offerAgeMinutes >= STALE_PRICE_OFFER_MINUTES) {
        incidents.push({
          id: `stale-price-offer:${request.id}`,
          kind: "stale_price_offer",
          severity: "warning",
          requestId: request.id,
          tradeId: request.tradeId,
          listingId: request.listingId,
          status: request.status,
          ageMinutes: offerAgeMinutes,
        });
      }
    }

    const releaseDeadlineMs = toTimestamp(request.usdtReleaseDeadlineAt);
    const releaseIsOverdue = request.status === "usdt_release_pending"
      && !request.usdtSentAt
      && !request.completedAt
      && releaseDeadlineMs > 0
      && releaseDeadlineMs <= nowMs;
    if (releaseIsOverdue) {
      incidents.push({
        id: `overdue-usdt-release:${request.id}`,
        kind: "overdue_usdt_release",
        severity: "critical",
        requestId: request.id,
        tradeId: request.tradeId,
        listingId: request.listingId,
        status: request.status,
        ageMinutes: Math.max(0, Math.floor((nowMs - releaseDeadlineMs) / 60_000)),
      });
    }

    const warningAgeMinutes = ageMinutes(request.inactivityWarningSentAt, nowMs);
    if (
      request.status === "accepted"
      && Boolean(request.inactivityWarningSentAt)
      && !request.paymentSentAt
      && warningAgeMinutes >= STALLED_TRADE_AFTER_WARNING_MINUTES
    ) {
      incidents.push({
        id: `stalled-trade:${request.id}`,
        kind: "stalled_trade",
        severity: "warning",
        requestId: request.id,
        tradeId: request.tradeId,
        listingId: request.listingId,
        status: request.status,
        ageMinutes: warningAgeMinutes,
      });
    }
  }

  for (const listing of input.marketplaceListings) {
    if (!LOCKED_LISTING_STATUSES.has(listing.status) && !listing.activeTradeRequestId) continue;
    const linkedRequest = listing.activeTradeRequestId
      ? requestsById.get(listing.activeTradeRequestId)
      : undefined;
    if (linkedRequest && ACTIVE_TRADE_STATUSES.has(linkedRequest.status) && linkedRequest.listingId === listing.id) continue;
    incidents.push({
      id: `orphaned-listing-lock:${listing.id}`,
      kind: "orphaned_listing_lock",
      severity: "critical",
      requestId: linkedRequest?.id,
      tradeId: linkedRequest?.tradeId,
      listingId: listing.id,
      status: linkedRequest?.status,
      ageMinutes: ageMinutes(listing.lockedAt ?? listing.updatedAt, nowMs),
    });
  }

  for (const request of input.purchaseRequests) {
    if (!ACTIVE_TRADE_STATUSES.has(request.status)) continue;
    const listing = listingsById.get(request.listingId);
    if (listing?.activeTradeRequestId === request.id && LOCKED_LISTING_STATUSES.has(listing.status)) continue;
    incidents.push({
      id: `unlinked-active-trade:${request.id}`,
      kind: "unlinked_active_trade",
      severity: "critical",
      requestId: request.id,
      tradeId: request.tradeId,
      listingId: request.listingId,
      status: request.status,
      ageMinutes: ageMinutes(request.updatedAt ?? request.createdAt, nowMs),
    });
  }

  incidents.sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === "critical" ? -1 : 1;
    return right.ageMinutes - left.ageMinutes;
  });

  const overdueUsdtReleases = incidents.filter((incident) => incident.kind === "overdue_usdt_release").length;
  const stalePriceOffers = incidents.filter((incident) => incident.kind === "stale_price_offer").length;
  const stalledTrades = incidents.filter((incident) => incident.kind === "stalled_trade").length;
  const dataIntegrityIssues = incidents.filter(
    (incident) => incident.kind === "orphaned_listing_lock" || incident.kind === "unlinked_active_trade",
  ).length;
  const hasCriticalIncident = incidents.some((incident) => incident.severity === "critical");

  return {
    status: hasCriticalIncident ? "critical" : incidents.length ? "attention" : "healthy",
    generatedAt: now.toISOString(),
    activeTrades,
    pendingPriceOffers,
    stalePriceOffers,
    stalledTrades,
    overdueUsdtReleases,
    dataIntegrityIssues,
    incidents: incidents.slice(0, 12),
  };
}
