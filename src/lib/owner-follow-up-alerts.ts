import { adminCommissionDestination, adminMarketplaceListingsDestination } from "@/lib/action-destinations";
import { buildMarketplaceOperationalSnapshot } from "@/lib/marketplace-operational-health";
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
  // Dashboard pagination must not make an unresolved alert look resolved.
  const snapshot = buildMarketplaceOperationalSnapshot(db, now, { includeAllIncidents: true });
  const alerts: OwnerFollowUpAlert[] = snapshot.incidents.map(incident => {
    const request = incident.requestId ? requests.get(incident.requestId) : undefined;
    const episode = incident.kind === "stalled_trade"
      ? `${request?.status}:${request?.inactivityWarningSentAt}`
      : incident.kind === "overdue_usdt_release" ? request?.usdtReleaseDeadlineAt ?? "" : "";
    return {
      reason: `${OWNER_FOLLOW_UP_REASON}${incident.id}:${episode}`,
      title: "Action required: trade follow-up",
      titleAr: "إجراء مطلوب: متابعة صفقة",
      message: "A trade or listing needs follow-up. Open its current record to review the next action.",
      messageAr: "تحتاج صفقة أو عرض إلى متابعة. افتح السجل الحالي لمراجعة الإجراء التالي.",
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
    alerts.push({
      reason: `${OWNER_FOLLOW_UP_REASON}commission:${commission.id}:${commission.paymentVerificationStatus}:${commission.paymentSubmittedAt ?? ""}`,
      title: "Action required: commission verification",
      titleAr: "إجراء مطلوب: التحقق من دفعة عمولة",
      message: failed
        ? "A commission payment could not be verified. Review the payment record before taking action."
        : "A commission is still awaiting a verified payment match. Review the current payment record before requesting another payment.",
      messageAr: failed
        ? "تعذّر التحقق من دفعة عمولة. راجع سجل الدفع قبل اتخاذ إجراء."
        : "لا تزال عمولة بانتظار مطابقة دفعة موثّقة. راجع سجل الدفع الحالي قبل طلب دفعة أخرى.",
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
