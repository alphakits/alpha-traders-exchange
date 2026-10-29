import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const noticeKey = new RegExp(`^demand-notice:(demand-${uuid}):[1-9]\\d*:(new|cancelled|expired|offer-${uuid}|withdrawn-offer-${uuid})$`);

/** Identify existing notices independently of optional email delivery metadata.
 * Only the generated recipient-bound ID and matching canonical path qualify. */
export function demandNotificationDestination(
  notice: Pick<AlphaExchangeNotification, "id" | "userId" | "relatedHref" | "actionHref">,
) {
  if (!notice.userId || !notice.id.endsWith(`:${notice.userId}`)) return null;
  const match = noticeKey.exec(notice.id.slice(0, -(notice.userId.length + 1)));
  if (!match) return null;
  const offerId = match[2].startsWith("withdrawn-") ? match[2].slice("withdrawn-".length)
    : match[2].startsWith("offer-") ? match[2] : null;
  const href = `/usdt-exchange/requests/${match[1]}${offerId ? `?offer=${offerId}` : ""}`;
  if (notice.relatedHref === href || notice.actionHref === href) return href;
  // Older read-state writes persisted the generic listing fallback. Repair
  // only that known value; the generated ID still binds the exact destination.
  const oldFallback = [notice.relatedHref, notice.actionHref];
  return oldFallback.some(value => value === "/usdt-exchange")
    && oldFallback.every(value => value === undefined || value === "/usdt-exchange") ? href : null;
}
