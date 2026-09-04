import type { AlphaExchangeDb, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";

export const MARKETPLACE_SMOKE_TEST_MARKER = "AUTOMATED PRODUCTION SMOKE TEST — DO NOT BUY";

const MAX_SMOKE_TEST_USDT = 10;
const SAFE_PURGE_STATUSES = new Set(["pending", "accepted", "declined", "cancelled"]);
const SMOKE_TEST_TRUST_REASONS = new Set(["Listing created", "Listing approved", "Trade lifecycle updated"]);

type MarketplaceSmokeTestPurgePlan = {
  listing: MarketplaceListing;
  requests: PurchaseRequest[];
  requestIds: Set<string>;
  tradeIds: Set<string>;
  referenceTokens: string[];
  cleanupWindowStartMs: number;
  cleanupWindowEndMs: number;
};

function toNumber(value: unknown) {
  return Number(String(value ?? "").replace(/[^\d.]/g, ""));
}

function displayToken(prefix: "LS" | "TR", value: number | undefined) {
  return value && Number.isFinite(value) ? `${prefix}-${Math.trunc(value).toString().padStart(6, "0")}` : null;
}

function withinCleanupWindow(value: string | undefined, plan: MarketplaceSmokeTestPurgePlan) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp)
    && timestamp >= plan.cleanupWindowStartMs
    && timestamp <= plan.cleanupWindowEndMs;
}

function referencesSmokeTest(value: unknown, plan: MarketplaceSmokeTestPurgePlan) {
  const serialized = JSON.stringify(value);
  return plan.referenceTokens.some((token) => serialized.includes(token));
}

export function isMarketplaceSmokeTestListing(listing: Pick<MarketplaceListing, "sellerDescription" | "availableAmount">) {
  const amount = toNumber(listing.availableAmount);
  return String(listing.sellerDescription ?? "").trim() === MARKETPLACE_SMOKE_TEST_MARKER
    && amount > 0
    && amount <= MAX_SMOKE_TEST_USDT;
}

export function buildMarketplaceSmokeTestPurgePlan(db: AlphaExchangeDb, listingId: string): MarketplaceSmokeTestPurgePlan {
  const listing = db.marketplaceListings.find((candidate) => candidate.id === listingId);
  if (!listing) throw new Error("Smoke-test listing not found.");
  if (!isMarketplaceSmokeTestListing(listing)) {
    throw new Error("Only a clearly marked smoke-test listing of 10 USDT or less can be purged.");
  }

  const requests = db.purchaseRequests.filter((request) => request.listingId === listing.id);
  if (requests.length > 1) {
    throw new Error("Smoke-test purge stopped because the listing has more than one buyer request.");
  }

  for (const request of requests) {
    if (request.sellerId !== listing.sellerId || !SAFE_PURGE_STATUSES.has(request.status)) {
      throw new Error("Smoke-test purge stopped because the trade is no longer in a safe test-only state.");
    }
    if (
      toNumber(request.usdtAmount) <= 0
      || toNumber(request.usdtAmount) > MAX_SMOKE_TEST_USDT
      || request.paymentSentAt
      || request.fundsReceivedAt
      || request.usdtReleaseStartedAt
      || request.usdtSentAt
      || request.completedAt
      || request.buyerEvidence
      || request.sellerEvidence
    ) {
      throw new Error("Smoke-test purge stopped because payment, evidence, release, or completion data exists.");
    }
    const unsafeUserMessage = (request.messages ?? []).some((message) =>
      message.kind === "user"
      && (!message.message.startsWith("SMOKE TEST ") || Boolean(message.imageUrl || message.imageName)),
    );
    if (unsafeUserMessage) {
      throw new Error("Smoke-test purge stopped because the trade contains non-test user content.");
    }
  }

  const requestIds = new Set(requests.map((request) => request.id));
  const tradeIds = new Set(requests.flatMap((request) => request.tradeId ? [request.tradeId] : []));
  if (db.commissionRecords.some((record) => record.listingId === listing.id || requestIds.has(record.purchaseRequestId))) {
    throw new Error("Smoke-test purge stopped because commission records exist.");
  }
  if (db.tradeEvidenceFiles.some((evidence) => requestIds.has(evidence.purchaseRequestId))) {
    throw new Error("Smoke-test purge stopped because evidence files exist.");
  }
  if (db.disputes.some((dispute) => requestIds.has(dispute.purchaseRequestId) || tradeIds.has(dispute.tradeId))) {
    throw new Error("Smoke-test purge stopped because dispute records exist.");
  }
  if (db.sellerReports.some((report) => Boolean(report.purchaseRequestId && requestIds.has(report.purchaseRequestId)))) {
    throw new Error("Smoke-test purge stopped because seller-report records exist.");
  }

  const listingDisplayToken = displayToken("LS", listing.displayNumber);
  const tradeDisplayTokens = requests.flatMap((request) => {
    const token = displayToken("TR", request.displayNumber);
    return token ? [token] : [];
  });
  const eventTimes = [listing.createdAt, listing.updatedAt, ...requests.flatMap((request) => [request.createdAt, request.updatedAt])]
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  const cleanupWindowStartMs = Math.min(...eventTimes);
  const cleanupWindowEndMs = Math.max(...eventTimes) + 120_000;

  return {
    listing,
    requests,
    requestIds,
    tradeIds,
    referenceTokens: [
      listing.id,
      ...(listingDisplayToken ? [listingDisplayToken] : []),
      ...requestIds,
      ...tradeIds,
      ...tradeDisplayTokens,
      MARKETPLACE_SMOKE_TEST_MARKER,
    ],
    cleanupWindowStartMs,
    cleanupWindowEndMs,
  };
}

export function purgeMarketplaceSmokeTestSnapshot(db: AlphaExchangeDb, listingId: string) {
  const plan = buildMarketplaceSmokeTestPurgePlan(db, listingId);
  const sellerId = plan.listing.sellerId;
  const next = structuredClone(db);

  next.marketplaceListings = next.marketplaceListings.filter((listing) => listing.id !== plan.listing.id);
  next.purchaseRequests = next.purchaseRequests.filter((request) => !plan.requestIds.has(request.id));
  next.commissionRecords = next.commissionRecords.filter((record) =>
    record.listingId !== plan.listing.id && !plan.requestIds.has(record.purchaseRequestId),
  );
  next.tradeEvidenceFiles = next.tradeEvidenceFiles.filter((evidence) => !plan.requestIds.has(evidence.purchaseRequestId));
  next.tradeMessages = (next.tradeMessages ?? []).filter((message) => !plan.requestIds.has(message.purchaseRequestId));
  next.disputes = next.disputes.filter((dispute) =>
    !plan.requestIds.has(dispute.purchaseRequestId) && !plan.tradeIds.has(dispute.tradeId),
  );
  next.sellerReports = next.sellerReports.filter((report) =>
    !report.purchaseRequestId || !plan.requestIds.has(report.purchaseRequestId),
  );
  next.notifications = next.notifications.filter((notification) => {
    if (notification.relatedListingId === plan.listing.id) return false;
    if (notification.relatedRequestId && plan.requestIds.has(notification.relatedRequestId)) return false;
    if (notification.relatedTradeId && (plan.tradeIds.has(notification.relatedTradeId) || plan.requestIds.has(notification.relatedTradeId))) return false;
    const testTrustNotification = notification.userId === sellerId
      && notification.category === "trust"
      && withinCleanupWindow(notification.createdAt, plan)
      && (notification.title === "Trust score increased" || notification.title === "Prestige rank updated");
    return !testTrustNotification && !referencesSmokeTest(notification, plan);
  });
  next.auditLogs = next.auditLogs.filter((entry) => {
    if (entry.listingId === plan.listing.id) return false;
    if (entry.purchaseRequestId && plan.requestIds.has(entry.purchaseRequestId)) return false;
    const testTrustEntry = entry.action === "trust_score_updated"
      && entry.targetUserId === sellerId
      && withinCleanupWindow(entry.createdAt, plan)
      && Array.from(SMOKE_TEST_TRUST_REASONS).some((reason) => entry.details?.includes(`(${reason})`));
    return !testTrustEntry && !referencesSmokeTest(entry, plan);
  });
  next.activityLog = next.activityLog.filter((entry) => {
    const testTrustEntry = entry.userId === sellerId
      && entry.category === "trust"
      && withinCleanupWindow(entry.createdAt, plan)
      && (entry.title === "Trust score increased" || entry.title === "Prestige rank updated");
    return !testTrustEntry && !referencesSmokeTest(entry, plan);
  });
  next.trustScoreHistory = next.trustScoreHistory.filter((entry) =>
    !(entry.sellerId === sellerId
      && SMOKE_TEST_TRUST_REASONS.has(entry.reason)
      && withinCleanupWindow(entry.createdAt, plan)),
  );
  next.smsDeliveries = (next.smsDeliveries ?? []).filter((delivery) => !referencesSmokeTest(delivery, plan));

  return {
    snapshot: next,
    sellerId,
    requestIds: [...plan.requestIds],
    tradeIds: [...plan.tradeIds],
  };
}
