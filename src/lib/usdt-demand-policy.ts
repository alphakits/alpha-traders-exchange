import { subtractTradeAmounts, isTradeAmountLessThan } from "@/lib/trade-amount";
import { z } from "zod";
import { calculateTradePaymentTotal, canonicalizeTradeAmount, getPriceOfferBounds, validatePriceOffer, parseCardlessCashAmount, getPurchaseMinimumTrade, maximumIlsListingPrice } from "@alpha-traders/contracts";
import type { AlphaExchangeDb, AlphaExchangeUser, MarketplaceListing, PurchaseRequest } from "@/types/alpha-exchange";
import type { DemandTerms, UsdtDemand } from "@/types/usdt-demand";
import type { MarketSnapshot } from "@/types/market";
import { isFxReferenceUsable } from "@/lib/fx-reference-policy";
import { hasAdultConfirmation } from "@/lib/age-eligibility";
import { isVerified } from "@/lib/verification-bypass";
import { hasRole } from "@/lib/roles";
import { hasSellerOperationalAccess } from "@/lib/seller-approval-verification";

export const DEMAND_TTL_MS = 24 * 60 * 60 * 1000;
export const DEMAND_COOLDOWN_MS = 5 * 60 * 1000;
export class DemandError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); this.name = "DemandError"; }
}
export const demandTermsSchema = z.object({
  amount: z.string().regex(/^\d{1,9}(?:\.\d{1,6})?$/).refine(v => Number(v) > 0).transform(v => canonicalizeTradeAmount(v)!),
  price: z.string().regex(/^\d{1,4}(?:\.\d{1,2})?$/).refine(v => Number(v) > 0).transform(v => Number(v).toFixed(2)),
  network: z.enum(["TRC20", "BEP20", "ERC20", "SOL"]),
  paymentMethod: z.enum(["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"]),
  city: z.string().trim().max(80).regex(/^[\p{L}\p{M}\s.,'’\-]*$/u).default(""),
}).strict().refine(v => v.paymentMethod !== "Face-to-Face (Meet in Person)" || (v.city.length >= 2 && /\p{L}/u.test(v.city)), "Enter the meeting city.")
  .transform(v => ({ ...v, city: v.paymentMethod === "Face-to-Face (Meet in Person)" ? v.city : "" }));
export const demandCreateSchema = z.object({ terms: demandTermsSchema, operationId: z.string().uuid() }).strict();
export const demandChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), revision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("renew"), revision: z.number().int().positive(), terms: demandTermsSchema }).strict(),
]);
export const demandOfferSchema = z.object({ revision: z.number().int().positive(), listingId: z.string().min(1).max(100), price: z.string().regex(/^\d{1,4}(?:\.\d{1,2})?$/), operationId: z.string().uuid() }).strict();
export function demandEnabled() { return process.env.ALPHA_USDT_REQUESTS_ENABLED === "1"; }
export function assertDemandEnabled() {
  if (!demandEnabled()) throw new DemandError("FEATURE_UNAVAILABLE", "USDT requests are unavailable.", 404);
}
export function assertDemandActor(user: AlphaExchangeUser | undefined): asserts user is AlphaExchangeUser {
  if (!user || user.disabled || !user.emailVerified || !isVerified(user) || !hasAdultConfirmation(user)
    || !(hasRole(user, "buyer") || hasSellerOperationalAccess(user))) {
    throw new DemandError("ACCESS_DENIED", "A verified adult exchange account is required.", 403);
  }
}
export function canRespond(db: AlphaExchangeDb, seller: AlphaExchangeUser | undefined, requesterId: string) {
  try { assertDemandActor(seller); } catch { return false; }
  const buyer = db.users.find(u => u.id === requesterId);
  try { assertDemandActor(buyer); } catch { return false; }
  return seller.id !== requesterId && hasSellerOperationalAccess(seller) && !seller.isProfileHidden
    && seller.availabilityStatus !== "vacation"
    && !seller.blockedUserIds?.includes(requesterId) && !buyer.blockedUserIds?.includes(seller.id)
    && !(db.marketplaceEnforcementRecords ?? []).some(r => r.sellerId === seller.id && r.status === "active");
}
export function demandReference(market: MarketSnapshot, now = Date.now()) {
  if (!isFxReferenceUsable(market, now)) return null;
  const bounds = getPriceOfferBounds(market.pairs.usdtIls.price);
  return bounds ? { price: String(market.pairs.usdtIls.price), minimum: (Math.ceil((market.pairs.usdtIls.price - 0.35 - Number.EPSILON * 4) * 100) / 100).toFixed(2), maximum: maximumIlsListingPrice(market.pairs.usdtIls.price).toFixed(2), quotedAt: market.pairs.usdtIls.quotedAt } : null;
}
export function assertDemandPrice(price: string, market: MarketSnapshot, now = Date.now()) {
  const reference = demandReference(market, now);
  if (!reference) throw new DemandError("QUOTE_UNAVAILABLE", "A fresh USD/ILS reference is required. Please try again shortly.");
  const result = validatePriceOffer(reference.price, price);
  if (!result.ok || Number(price) < Number(reference.minimum) || Number(price) > Number(reference.maximum)) throw new DemandError("PRICE_OUTSIDE_BAND", `Price must be between ₪${reference.minimum} and ₪${reference.maximum}.`);
  return result.offeredPrice;
}
export function assertDemandTerms(terms: DemandTerms, market: MarketSnapshot, now = Date.now()) {
  assertDemandPrice(terms.price, market, now);
  const total = calculateTradePaymentTotal(terms.amount, terms.price, true);
  if (!total || Number(total) < 0.01) throw new DemandError("AMOUNT_INVALID", "The payment total must be at least ₪0.01.");
  if (terms.paymentMethod === "Cardless ATM Withdrawal" && !parseCardlessCashAmount(total)) throw new DemandError("ATM_AMOUNT_INVALID", "The total including the buyer fee must match an ATM cash amount in ₪100 steps.");
}
export function isDemandReservedTrade(trade: PurchaseRequest) {
  return ["accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"].includes(trade.status)
    || (trade.status === "pending" && Boolean(trade.usdtDemandId));
}
export function demandListingAvailableAmount(db: AlphaExchangeDb, listing: MarketplaceListing, excludingTrade?: string) {
  return db.purchaseRequests.filter(t => t.id !== excludingTrade && t.sellerId === listing.sellerId
    && t.listingId === listing.id && isDemandReservedTrade(t))
    .reduce((remaining, t) => subtractTradeAmounts(remaining, t.usdtAmount) ?? "0", listing.availableAmount);
}
export function demandState(db: AlphaExchangeDb, demand: UsdtDemand, market: MarketSnapshot, now = Date.now()) {
  if (demand.state === "matched") {
    const trade = db.purchaseRequests.find(t => t.id === demand.purchaseRequestId);
    if (trade && ["completed", "review_open", "locked"].includes(trade.status)) return "fulfilled" as const;
    if (trade && ["cancelled", "declined"].includes(trade.status)) return "trade_cancelled" as const;
    return "matched" as const;
  }
  if (demand.state !== "open") return demand.state;
  if (Date.parse(demand.expiresAt) <= now) return "expired" as const;
  try { assertDemandPrice(demand.price, market, now); } catch { return "paused" as const; }
  return "open" as const;
}
export function assertDemandListing(db: AlphaExchangeDb, demand: UsdtDemand, listing: MarketplaceListing | undefined, excludingTrade?: string): asserts listing is MarketplaceListing {
  const seller = db.users.find(u => u.id === listing?.sellerId);
  if (!listing || !canRespond(db, seller, demand.requesterId) || !["active", "matched", "in_trade"].includes(listing.status)
    || (listing.approvalStatus !== undefined && listing.approvalStatus !== "approved")
    || listing.currency !== "ILS" || listing.network !== demand.network
    || !(listing.paymentMethods ?? [listing.paymentMethod]).includes(demand.paymentMethod)
    || (demand.paymentMethod === "Face-to-Face (Meet in Person)"
      && normalizeDemandCity(seller?.city) !== normalizeDemandCity(demand.city))
    || (listing.expiresAt && Date.parse(listing.expiresAt) <= Date.now())) throw new DemandError("LISTING_UNAVAILABLE", "Choose an approved, available listing matching this request.");
  const active = db.purchaseRequests.filter(t => t.id !== excludingTrade && t.sellerId === listing.sellerId && isDemandReservedTrade(t));
  if (active.length >= 3) throw new DemandError("SELLER_TRADE_LIMIT", "The seller already has three open trades.");
  const available = demandListingAvailableAmount(db, listing, excludingTrade);
  const amount = Number(demand.amount);
  if (isTradeAmountLessThan(available, demand.amount) !== false
    || amount < getPurchaseMinimumTrade(listing.minimumTrade, demand.paymentMethod === "Cardless ATM Withdrawal")
    || amount > Number(listing.maximumTrade || listing.availableAmount)) throw new DemandError("AMOUNT_UNAVAILABLE", "The requested amount no longer fits this listing's available amount or limits.");
}
function normalizeDemandCity(city: string | undefined) {
  return (city ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}
export type DemandMatchInput = { buyerId: string; demandId: string; offerId: string; revision: number; listingId: string; amount: string; paymentMethod?: string; network?: string };
export function validateDemandMatch(db: AlphaExchangeDb, input: DemandMatchInput, market: MarketSnapshot, excludingTrade?: string) {
  assertDemandEnabled();
  assertDemandActor(db.users.find(u => u.id === input.buyerId));
  const demand = (db.usdtDemands ?? []).find(d => d.id === input.demandId && d.requesterId === input.buyerId);
  if (!demand) throw new DemandError("NOT_FOUND", "Request not found.", 404);
  if (demand.state !== "open" || demand.revision !== input.revision || Date.parse(demand.expiresAt) <= Date.now()) throw new DemandError("REQUEST_CHANGED", "This request changed or closed. Refresh before continuing.");
  const offer = demand.offers.find(o => o.id === input.offerId);
  if (!offer || offer.state !== "open" || offer.revision !== demand.revision || offer.listingId !== input.listingId) throw new DemandError("OFFER_CHANGED", "This response is no longer available.");
  if (input.amount !== demand.amount || input.paymentMethod !== demand.paymentMethod || input.network !== demand.network) throw new DemandError("TERMS_CHANGED", "Review the current request amount, payment method and network.");
  assertDemandTerms(demand, market);
  assertDemandTerms({ ...demand, price: offer.price }, market);
  const listing = db.marketplaceListings.find(l => l.id === offer.listingId);
  assertDemandListing(db, demand, listing, excludingTrade);
  if (listing.sellerId !== offer.sellerId || listing.updatedAt !== offer.listingUpdatedAt) throw new DemandError("LISTING_CHANGED", "The seller changed this listing. Ask for an updated response.");
  return { demand, offer };
}
export function commitDemandMatch(db: AlphaExchangeDb, input: DemandMatchInput, market: MarketSnapshot, trade: PurchaseRequest) {
  const { demand, offer } = validateDemandMatch(db, input, market, trade.id);
  if (trade.pricePerUsdt !== offer.price || trade.feePolicyVersion !== "buyer_seller_1pct_v1") throw new DemandError("TERMS_CHANGED", "Review the seller price and buyer fee.");
  demand.state = "matched";
  demand.purchaseRequestId = trade.id;
  demand.acceptedOfferId = offer.id;
  demand.updatedAt = new Date().toISOString();
  demand.history.push({ action: "matched", actorId: input.buyerId, at: demand.updatedAt, revision: demand.revision,
    purchaseRequestId: trade.id, offerId: offer.id });
  for (const candidate of demand.offers) if (candidate.state === "open") candidate.state = candidate.id === offer.id ? "accepted" : "superseded";
}
