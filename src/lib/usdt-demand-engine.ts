import { randomUUID } from "node:crypto";
import type { AlphaExchangeDb, AlphaExchangeUser } from "@/types/alpha-exchange";
import type { DemandTerms, UsdtDemand, DemandWorkspace } from "@/types/usdt-demand";
import type { MarketSnapshot } from "@/types/market";
import { publicAccountName } from "@/lib/public-account-identity";
import { hasSellerOperationalAccess } from "@/lib/seller-approval-verification";
import { assertDemandActor, assertDemandListing, assertDemandTerms, canRespond, DEMAND_COOLDOWN_MS, DEMAND_TTL_MS, demandChangeSchema, demandCreateSchema, DemandError, demandOfferSchema, demandReference, demandState } from "./usdt-demand-policy";

function actor(db: AlphaExchangeDb, id: string) {
  const user = db.users.find(u => u.id === id); assertDemandActor(user); return user;
}
function expire(db: AlphaExchangeDb, now: number) {
  for (const d of db.usdtDemands ?? []) if (d.state === "open" && Date.parse(d.expiresAt) <= now) {
    d.state = "expired"; d.updatedAt = new Date(now).toISOString();
  }
}
function notice(db: AlphaExchangeDb, user: AlphaExchangeUser, d: UsdtDemand, offerId?: string) {
  const id = `demand-notice:${d.id}:${d.revision}:${offerId ?? "new"}:${user.id}`;
  if (db.notifications.some(n => n.id === id)) return;
  const title = offerId ? "New response to your USDT request" : "New USDT request";
  const message = `${d.amount} USDT requested at ₪${d.price} per USDT. ${d.paymentMethod} · ${d.network}.`;
  const href = `/usdt-exchange/requests/${encodeURIComponent(d.id)}${offerId ? `?offer=${encodeURIComponent(offerId)}` : ""}`;
  db.notifications.push({ id, userId: user.id, category: "listing", title, titleEn: title, message, messageEn: message,
    titleAr: offerId ? "رد جديد على طلب USDT الخاص بك" : "طلب USDT جديد",
    messageAr: `طلب ${d.amount} USDT بسعر ₪${d.price} لكل USDT. ${d.network}.`,
    isRead: false, createdAt: new Date().toISOString(), relatedHref: href, actionHref: href,
    state: user.notificationPreferences?.inApp === false ? "archived" : "unread",
    archivedAt: user.notificationPreferences?.inApp === false ? new Date().toISOString() : undefined,
    demandEmail: user.notificationPreferences?.email === true ? { demandId: d.id, offerId, revision: d.revision, state: "pending" } : undefined,
  });
}
function notifySellers(db: AlphaExchangeDb, d: UsdtDemand) {
  for (const user of db.users) if (canRespond(db, user, d.requesterId)) notice(db, user, d);
}
function assertSingleOpen(db: AlphaExchangeDb, userId: string, exceptId?: string) {
  if ((db.usdtDemands ?? []).some(d => d.requesterId === userId && d.id !== exceptId && d.state === "open")) throw new DemandError("OPEN_REQUEST_EXISTS", "You already have an open USDT request. Update or cancel it first.");
}
function assertPostRate(db: AlphaExchangeDb, userId: string, now: number) {
  const posts = (db.usdtDemands ?? []).filter(d => d.requesterId === userId)
    .flatMap(d => d.history.filter(h => ["created", "renewed"].includes(h.action)));
  if (posts.some(h => now - Date.parse(h.at) < DEMAND_COOLDOWN_MS)) throw new DemandError("REQUEST_COOLDOWN", "Wait five minutes between publishing or renewing requests.", 429);
  if (posts.filter(h => now - Date.parse(h.at) < DEMAND_TTL_MS).length >= 5) throw new DemandError("DAILY_LIMIT", "You can publish or renew up to five requests per day.", 429);
}
export function createDemand(db: AlphaExchangeDb, userId: string, body: unknown, market: MarketSnapshot, assertCanPublish: () => void = () => {}) {
  const input = demandCreateSchema.parse(body); actor(db, userId);
  const previous = (db.usdtDemands ?? []).find(d => d.requesterId === userId && d.operationId === input.operationId);
  if (previous) {
    const originalTerms = previous.createTerms ?? previous;
    if ((Object.keys(input.terms) as Array<keyof DemandTerms>).some(k => originalTerms[k] !== input.terms[k])) throw new DemandError("IDEMPOTENCY_CONFLICT", "This submission key was already used with different terms.");
    return previous;
  }
  assertCanPublish();
  const now = Date.now(); expire(db, now); assertSingleOpen(db, userId); assertPostRate(db, userId, now);
  assertDemandTerms(input.terms, market, now);
  const at = new Date(now).toISOString();
  const demand: UsdtDemand = { ...input.terms, city: input.terms.paymentMethod === "Face-to-Face (Meet in Person)" ? input.terms.city : "",
    id: `demand-${randomUUID()}`, requesterId: userId, operationId: input.operationId, createTerms: { ...input.terms }, revision: 1, state: "open",
    createdAt: at, updatedAt: at, expiresAt: new Date(now + DEMAND_TTL_MS).toISOString(), offers: [],
    history: [{ action: "created", actorId: userId, at, revision: 1 }] };
  (db.usdtDemands ??= []).push(demand); notifySellers(db, demand); return demand;
}
export function changeDemand(db: AlphaExchangeDb, userId: string, id: string, body: unknown, market: MarketSnapshot) {
  const input = demandChangeSchema.parse(body); actor(db, userId);
  const demand = (db.usdtDemands ?? []).find(d => d.id === id && d.requesterId === userId);
  if (!demand) throw new DemandError("NOT_FOUND", "Request not found.", 404);
  if (demand.revision !== input.revision) throw new DemandError("REQUEST_CHANGED", "This request changed. Refresh before trying again.");
  const state = demandState(db, demand, market);
  if (["matched", "fulfilled"].includes(state)) throw new DemandError("TRADE_EXISTS", "Continue in the existing Trade Room.");
  const now = Date.now(); expire(db, now);
  if (input.action === "cancel" && demand.state === "cancelled") return demand;
  if (input.action === "renew") {
    assertSingleOpen(db, userId, id); assertPostRate(db, userId, now); assertDemandTerms(input.terms, market, now);
    demand.createTerms ??= { amount: demand.amount, price: demand.price, network: demand.network, paymentMethod: demand.paymentMethod, city: demand.city };
    Object.assign(demand, input.terms); demand.state = "open"; demand.expiresAt = new Date(now + DEMAND_TTL_MS).toISOString();
  } else demand.state = "cancelled";
  demand.revision += 1; demand.updatedAt = new Date(now).toISOString();
  const priorTrade = { purchaseRequestId: demand.purchaseRequestId, offerId: demand.acceptedOfferId };
  delete demand.purchaseRequestId; delete demand.acceptedOfferId;
  for (const offer of demand.offers) if (offer.state === "open") offer.state = "superseded";
  demand.history.push({ action: input.action === "renew" ? "renewed" : "cancelled", actorId: userId, at: demand.updatedAt, revision: demand.revision, ...priorTrade });
  if (input.action === "renew") notifySellers(db, demand);
  return demand;
}
export function respondToDemand(db: AlphaExchangeDb, userId: string, id: string, body: unknown, market: MarketSnapshot) {
  const input = demandOfferSchema.parse(body); const seller = actor(db, userId);
  const demand = (db.usdtDemands ?? []).find(d => d.id === id);
  if (!demand || !canRespond(db, seller, demand.requesterId)) throw new DemandError("NOT_FOUND", "Request not found.", 404);
  const previous = demand.offers.find(o => o.sellerId === userId && o.operationId === input.operationId);
  if (previous) {
    if (previous.listingId !== input.listingId || previous.price !== Number(input.price).toFixed(2) || previous.revision !== input.revision) throw new DemandError("IDEMPOTENCY_CONFLICT", "This response key was already used with different terms.");
    return previous;
  }
  if (demandState(db, demand, market) !== "open" || input.revision !== demand.revision) throw new DemandError("REQUEST_CHANGED", "This request is no longer open with these terms.");
  assertDemandTerms({ ...demand, price: input.price }, market);
  const listing = db.marketplaceListings.find(l => l.id === input.listingId && l.sellerId === userId);
  assertDemandListing(db, demand, listing);
  if (demand.offers.some(o => o.sellerId === userId && Date.now() - Date.parse(o.createdAt) < 60_000)) throw new DemandError("RESPONSE_COOLDOWN", "Wait one minute before updating your response.", 429);
  if (demand.offers.length >= 100) throw new DemandError("RESPONSE_LIMIT", "This request has reached its response limit.");
  for (const offer of demand.offers) if (offer.sellerId === userId && offer.state === "open") offer.state = "superseded";
  const offer = { id: `offer-${randomUUID()}`, sellerId: userId, listingId: listing.id, listingUpdatedAt: listing.updatedAt,
    operationId: input.operationId, revision: demand.revision, price: Number(input.price).toFixed(2), state: "open" as const, createdAt: new Date().toISOString() };
  demand.offers.push(offer); demand.updatedAt = offer.createdAt;
  notice(db, db.users.find(u => u.id === demand.requesterId)!, demand, offer.id); return offer;
}
export function withdrawDemandOffer(db: AlphaExchangeDb, userId: string, id: string, offerId: string) {
  actor(db, userId);
  const demand = (db.usdtDemands ?? []).find(d => d.id === id);
  const offer = demand?.offers.find(o => o.id === offerId && o.sellerId === userId);
  if (!demand || !offer) throw new DemandError("NOT_FOUND", "Response not found.", 404);
  if (offer.state === "accepted") throw new DemandError("TRADE_EXISTS", "Continue in the Trade Room.");
  if (offer.state === "open") { offer.state = "withdrawn"; demand.updatedAt = new Date().toISOString(); }
}
export function readDemandWorkspace(db: AlphaExchangeDb, userId: string, market: MarketSnapshot, input: { id?: string; scope?: string; cursor?: string } = {}): DemandWorkspace {
  const user = actor(db, userId);
  const visible = (db.usdtDemands ?? []).filter(d => {
    if (input.id && d.id !== input.id) return false;
    if (d.requesterId === userId) return Boolean(input.id || input.scope !== "available");
    if (!canRespond(db, user, d.requesterId)) return false;
    return Boolean(input.id || (input.scope === "available" && demandState(db, d, market) === "open"));
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  if (input.id && !visible.length) throw new DemandError("NOT_FOUND", "Request not found.", 404);
  const start = input.cursor ? visible.findIndex(d => d.id === input.cursor) + 1 : 0;
  const page = visible.slice(start, start + 30);
  const requests = page.map(d => {
    const state = demandState(db, d, market);
    const offers = d.offers.filter(o => d.requesterId === userId || o.sellerId === userId).map(o => {
      let available = state === "open" && o.state === "open" && o.revision === d.revision;
      try {
        assertDemandTerms({ ...d, price: o.price }, market);
        const listing = db.marketplaceListings.find(l => l.id === o.listingId);
        assertDemandListing(db, d, listing); available &&= listing.updatedAt === o.listingUpdatedAt && listing.sellerId === o.sellerId;
      } catch { available = false; }
      return { id: o.id, listingId: o.listingId, price: o.price, revision: o.revision, state: o.state,
        sellerName: publicAccountName(db.users.find(u => u.id === o.sellerId) ?? { id: o.sellerId }), isMine: o.sellerId === userId, available };
    });
    const canSeeTrade = d.requesterId === userId || d.offers.some(o => o.id === d.acceptedOfferId && o.sellerId === userId);
    return { id: d.id, amount: d.amount, price: d.price, network: d.network, paymentMethod: d.paymentMethod, city: d.city,
      revision: d.revision, state, updatedAt: d.updatedAt, expiresAt: d.expiresAt, isMine: d.requesterId === userId,
      requesterName: publicAccountName(db.users.find(u => u.id === d.requesterId) ?? { id: d.requesterId }),
      purchaseRequestId: canSeeTrade ? d.purchaseRequestId : undefined, offers };
  });
  const selected = input.id ? page[0] : undefined;
  const listings = selected && selected.requesterId !== userId ? db.marketplaceListings.filter(l => {
    if (l.sellerId !== userId) return false;
    try { assertDemandListing(db, selected, l); return true; } catch { return false; }
  }).map(l => ({ id: l.id, price: l.price, amount: l.availableAmount })) : [];
  return { actorId: userId, canRespond: hasSellerOperationalAccess(user), reference: demandReference(market), requests, listings,
    nextCursor: start + page.length < visible.length ? page.at(-1)!.id : null };
}
