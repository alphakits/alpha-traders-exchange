import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

export const COMMISSION_PAYMENT_DUE_NOTIFICATION_REASON = "commission_payment_due";

/**
 * A commission payment always targets one persisted commission record. The
 * receiving page revalidates that record for the authenticated seller before
 * it reveals a payment form or permits submission.
 */
export function commissionPaymentDestination(commissionId: string) {
  const normalizedId = commissionId.trim();
  if (!normalizedId) throw new Error("A commission record is required for payment.");
  return `/usdt-exchange?commission=pay&commissionId=${encodeURIComponent(normalizedId)}#commission-payment`;
}

export function getCommissionPaymentIdFromHref(href: string | null | undefined) {
  if (!href) return null;
  try {
    const parsed = new URL(href, "https://www.alphatraders.co.il");
    const normalizedPath = parsed.pathname.replace(/^\/(?:en|ar)(?=\/)/i, "");
    if (normalizedPath !== "/usdt-exchange" || parsed.searchParams.get("commission") !== "pay") return null;
    return parsed.searchParams.get("commissionId")?.trim() || null;
  } catch {
    return null;
  }
}

export function getCommissionPaymentNotificationDestination(
  notification: Pick<AlphaExchangeNotification, "reason" | "actionHref" | "relatedHref">,
) {
  if (String(notification.reason ?? "").trim() !== COMMISSION_PAYMENT_DUE_NOTIFICATION_REASON) return null;
  const commissionId = getCommissionPaymentIdFromHref(notification.actionHref)
    ?? getCommissionPaymentIdFromHref(notification.relatedHref);
  return commissionId ? commissionPaymentDestination(commissionId) : null;
}

export function isCommissionPaymentNotification(
  notification: Pick<AlphaExchangeNotification, "reason" | "actionHref" | "relatedHref">,
) {
  return Boolean(getCommissionPaymentNotificationDestination(notification));
}
