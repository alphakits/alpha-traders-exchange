import "server-only";
import { getAlphaExchangeRepository } from "./alpha-exchange-repository";
import { sendMarketplaceEmail } from "./marketplace-email-delivery";
import { getMarketSnapshot } from "./market-service";
import { canRespond, demandEnabled, demandReference, assertDemandActor, assertDemandListing, assertDemandTerms } from "./usdt-demand-policy";
import { DEMAND_TABLES, mutateDemands } from "./usdt-demand-store";
import type { AlphaExchangeDb, AlphaExchangeNotification } from "@/types/alpha-exchange";
import type { MarketSnapshot } from "@/types/market";

function deliveryEnabled() {
  return demandEnabled() && process.env.ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED === "1";
}

function eligibleNotice(db: AlphaExchangeDb, notice: AlphaExchangeNotification, market: MarketSnapshot) {
  const intent = notice.demandEmail;
  const d = db.usdtDemands?.find(candidate => candidate.id === intent?.demandId);
  const user = db.users.find(candidate => candidate.id === notice.userId);
  if (!intent || intent.state === "suppressed" || !d || !user || user.notificationPreferences?.email !== true
    || intent.revision !== d.revision || d.state !== "open"
    || !Number.isFinite(Date.parse(d.expiresAt)) || Date.parse(d.expiresAt) <= Date.now()
    || !Number.isFinite(Date.parse(notice.createdAt))
    || Date.now() - Date.parse(notice.createdAt) >= 23 * 60 * 60 * 1000) return false;
  try {
    assertDemandActor(user);
    if (!intent.offerId) {
      if (!canRespond(db, user, d.requesterId)) return false;
    } else {
      const offer = d.offers.find(candidate => candidate.id === intent.offerId);
      if (!offer || offer.state !== "open" || offer.revision !== d.revision || d.requesterId !== user.id
        || !canRespond(db, db.users.find(candidate => candidate.id === offer.sellerId), user.id)) return false;
      const listing = db.marketplaceListings.find(candidate => candidate.id === offer.listingId);
      assertDemandListing(db, d, listing);
      if (listing.sellerId !== offer.sellerId || listing.updatedAt !== offer.listingUpdatedAt) return false;
    }
  } catch { return false; }
  // A provider outage must pause delivery, not permanently retire an otherwise
  // eligible notice. The durable worker preserves its bounded retry window.
  if (!demandReference(market)) throw new Error("Demand email reference temporarily unavailable.");
  try {
    assertDemandTerms(d, market);
    const offer = intent.offerId ? d.offers.find(candidate => candidate.id === intent.offerId) : undefined;
    if (offer) assertDemandTerms({ ...d, price: offer.price }, market);
    return true;
  } catch { return false; }
}

/** Revalidate every durable delivery attempt, including delayed/reclaimed jobs.
 * The frozen outbox key is the canonical notice ID, so it also binds the
 * recipient, request revision and exact response without another stored copy. */
export async function canDeliverDemandEmail(recipientId: string, email: string, noticeId: string, event: string) {
  if (!deliveryEnabled()) return false;
  const db = await (await getAlphaExchangeRepository()).loadSelectedSnapshot(DEMAND_TABLES);
  const notice = db.notifications.find(candidate => candidate.id === noticeId && candidate.userId === recipientId);
  const user = db.users.find(candidate => candidate.id === recipientId);
  if (!notice?.demandEmail || !user || user.email.toLowerCase() !== email.toLowerCase()
    || event !== (notice.demandEmail.offerId ? "usdt_demand_response" : "usdt_demand_published")) return false;
  const market = await getMarketSnapshot();
  return deliveryEnabled() && eligibleNotice(db, notice, market);
}

/** Durable notification intents + provider idempotency. Delivery is independently off by default. */
export async function queueDemandEmails() {
  if (!deliveryEnabled()) return;
  const db = await (await getAlphaExchangeRepository()).loadSelectedSnapshot(DEMAND_TABLES);
  const notices = db.notifications.filter(n => n.demandEmail?.state === "pending").slice(0, 30);
  if (!notices.length) return;
  const market = await getMarketSnapshot();
  for (const notice of notices) {
    const intent = notice.demandEmail!;
    const user = db.users.find(u => u.id === notice.userId);
    let allowed = deliveryEnabled() && eligibleNotice(db, notice, market);
    if (allowed && user) {
      const result = await sendMarketplaceEmail({
        event: intent.offerId ? "usdt_demand_response" : "usdt_demand_published", to: user.email,
        recipientName: user.fullName, recipientLocale: user.preferredLocale === "ar" ? "ar" : "en",
        title: { en: notice.titleEn ?? notice.title, ar: notice.titleAr ?? notice.title },
        message: { en: notice.messageEn ?? notice.message, ar: notice.messageAr ?? notice.message },
        actionLabel: { en: "View USDT request", ar: "عرض طلب USDT" },
        actionPath: notice.relatedHref!, idempotencyKey: notice.id,
      });
      if (!result.ok) {
        if (result.reason !== "email_delivery_terminal") continue;
        // Permanent outbox rejections must not occupy the first recovery batch
        // forever and prevent later notices from being considered.
        allowed = false;
      }
    }
    await mutateDemands(fresh => {
      const stored = fresh.notifications.find(n => n.id === notice.id)?.demandEmail;
      if (stored?.state === "pending") stored.state = allowed ? "queued" : "suppressed";
    });
  }
}
