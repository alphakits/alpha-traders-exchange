import { adminCommissionDestination, adminMarketplaceListingsDestination } from "@/lib/action-destinations";
import { buildMarketplaceOperationalSnapshot } from "@/lib/marketplace-operational-health";
import { formatCommissionId, formatListingId, formatTradeId } from "@/lib/format-id";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

export const OWNER_FOLLOW_UP_REASON = "owner_follow_up_v1:";
export const COMMISSION_FOLLOW_UP_DELAY_MS = 15 * 60_000;

export type OwnerFollowUpAlert = {
  reason: string;
  title: string;
  titleAr: string;
  message: string;
  messageAr: string;
  href: string;
  requestId?: string;
  listingId?: string;
  priority: "high" | "critical";
};

/** Read the same canonical states as the dashboard; never alter settlement. */
export function ownerFollowUpAlerts(
  db: Pick<AlphaExchangeDb, "marketplaceListings" | "purchaseRequests" | "commissionRecords">,
  now: Date,
): OwnerFollowUpAlert[] {
  const requests = new Map(db.purchaseRequests.map(request => [request.id, request]));
  const listings = new Map(db.marketplaceListings.map(listing => [listing.id, listing]));
  // Dashboard pagination must not make an unresolved alert look resolved.
  const snapshot = buildMarketplaceOperationalSnapshot(db, now, { includeAllIncidents: true });
  const alerts: OwnerFollowUpAlert[] = snapshot.incidents.map(incident => {
    const request = incident.requestId ? requests.get(incident.requestId) : undefined;
    const listing = incident.listingId ? listings.get(incident.listingId) : undefined;
    const reference = request ? formatTradeId(request.displayNumber, request.tradeId ?? request.id)
      : formatListingId(listing?.displayNumber, incident.listingId);
    const labels = {
      overdue_usdt_release: ["Overdue USDT release", "تأخر إرسال USDT"],
      stale_price_offer: ["Price offer waiting for response", "عرض سعر بانتظار الرد"],
      stalled_trade: ["Trade needs follow-up", "صفقة تحتاج إلى متابعة"],
      orphaned_listing_lock: ["Listing lock needs review", "قفل عرض يحتاج إلى مراجعة"],
      unlinked_active_trade: ["Trade linkage needs review", "ارتباط صفقة يحتاج إلى مراجعة"],
    };
    const episode = incident.kind === "stalled_trade"
      ? `${request?.status}:${request?.inactivityWarningSentAt}`
      : incident.kind === "overdue_usdt_release" ? request?.usdtReleaseDeadlineAt ?? "" : "";
    return {
      reason: `${OWNER_FOLLOW_UP_REASON}${incident.id}:${episode}`,
      title: "Action required: trade follow-up",
      titleAr: "إجراء مطلوب: متابعة صفقة",
      message: `${labels[incident.kind][0]} (${reference}). Open the current record to review the next action.`,
      messageAr: `${labels[incident.kind][1]} (${reference}). افتح السجل الحالي لمراجعة الإجراء التالي.`,
      href: request ? `/trade-room/${encodeURIComponent(request.id)}` : adminMarketplaceListingsDestination(incident.listingId),
      requestId: request?.id,
      listingId: incident.listingId,
      priority: incident.severity === "critical" ? "critical" : "high",
    };
  });
  for (const commission of db.commissionRecords) {
    if (commission.paymentStatus === "paid" || commission.paymentVerificationStatus === "verified") continue;
    const failed = commission.paymentVerificationStatus === "failed";
    const submittedAt = Date.parse(commission.paymentSubmittedAt ?? commission.paymentExpectedAmountAssignedAt ?? commission.createdAt);
    const delayed = commission.paymentVerificationStatus === "pending_verification"
      && Number.isFinite(submittedAt) && now.getTime() - submittedAt >= COMMISSION_FOLLOW_UP_DELAY_MS;
    if (!failed && !delayed) continue;
    const reference = formatCommissionId(commission.displayNumber, commission.id);
    alerts.push({
      reason: `${OWNER_FOLLOW_UP_REASON}commission:${commission.id}:${commission.paymentVerificationStatus}:${commission.paymentSubmittedAt ?? ""}`,
      title: "Action required: commission verification",
      titleAr: "إجراء مطلوب: التحقق من دفعة عمولة",
      message: failed
        ? `Commission ${reference} could not be verified. Review the payment record before taking action.`
        : `Commission ${reference} is still awaiting a verified payment match. Review the current payment record before requesting another payment.`,
      messageAr: failed
        ? `تعذّر التحقق من دفعة العمولة ${reference}. راجع سجل الدفع قبل اتخاذ إجراء.`
        : `لا تزال العمولة ${reference} بانتظار مطابقة دفعة موثّقة. راجع سجل الدفع الحالي قبل طلب دفعة أخرى.`,
      href: adminCommissionDestination(commission.id),
      priority: "high",
    });
  }
  const destinations = new Set<string>();
  return alerts.filter(alert => {
    if (destinations.has(alert.href)) return false;
    destinations.add(alert.href);
    return true;
  });
}
