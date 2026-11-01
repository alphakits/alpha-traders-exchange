import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { isCompletedBuyerPurchase, summarizeBuyerPurchases, validatedBuyerVolumeCredit } from "@/lib/buyer-purchase-progress";
import { getBuyerPrestigeProgress } from "@/lib/buyer-rank";
import { hasRole } from "@/lib/roles";
import { canonicalizeTradeAmount, subtractTradeAmounts } from "@/lib/trade-amount";
import type { AlphaExchangeDb, BuyerVolumeCredit } from "@/types/alpha-exchange";

export interface BuyerVolumeCreditInput {
  operationId: string;
  actorUserId: string;
  requestId: string;
  buyerId: string;
  expectedSettledUsdtAmount: string;
  creditedUsdtAmount: string;
  reason: string;
}

function fail(reason: string): never {
  throw new Error(`Buyer purchase credit rejected: ${reason}`);
}

function fingerprint(input: BuyerVolumeCreditInput) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

/**
 * Prepare a bounded, auditable buyer-benefit correction from canonical facts.
 * The caller must commit the request, audit row and runtime version atomically.
 * This does not manufacture a trade, a payment, a review or a completion time.
 */
export function prepareBuyerVolumeCredit(source: AlphaExchangeDb, raw: BuyerVolumeCreditInput, recordedAt: string) {
  const expectedSettledUsdtAmount = canonicalizeTradeAmount(raw.expectedSettledUsdtAmount);
  const creditedUsdtAmount = canonicalizeTradeAmount(raw.creditedUsdtAmount);
  if (!expectedSettledUsdtAmount || !creditedUsdtAmount) fail("valid positive USDT amounts are required.");
  const input: BuyerVolumeCreditInput = {
    operationId: raw.operationId, actorUserId: raw.actorUserId, requestId: raw.requestId, buyerId: raw.buyerId,
    expectedSettledUsdtAmount, creditedUsdtAmount, reason: raw.reason.trim(),
  };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,119}$/.test(input.operationId)) fail("a stable operation identity is required.");
  if (!input.reason || input.reason.length > 1000) fail("an owner reason of 1–1000 characters is required.");
  const actor = source.users.find(user => user.id === input.actorUserId);
  if (!actor || actor.disabled || !hasRole(actor, "owner")) fail("enabled owner access is required.");
  const request = source.purchaseRequests.find(item => item.id === input.requestId);
  if (!request || request.buyerId !== input.buyerId || !source.users.some(user => user.id === input.buyerId)) {
    fail("the request and buyer must match canonical history.");
  }
  if (!isCompletedBuyerPurchase(request)) fail("a completed purchase is required.");
  if (canonicalizeTradeAmount(request.usdtAmount) !== expectedSettledUsdtAmount) fail("the settled amount changed.");
  const additionalVolumeUsdt = subtractTradeAmounts(creditedUsdtAmount, expectedSettledUsdtAmount);
  if (additionalVolumeUsdt === null || additionalVolumeUsdt === "0") fail("the attested purchase credit must exceed the settled amount.");
  const inputFingerprint = fingerprint(input);
  const auditId = `audit-buyer-credit-${createHash("sha256").update(input.operationId).digest("hex").slice(0, 32)}`;
  const marker = request.buyerVolumeCredit;
  if (source.purchaseRequests.some(item => item.id !== request.id && item.buyerVolumeCredit?.operationId === input.operationId)) {
    fail("the operation identity is already used.");
  }
  if (marker) {
    const audit = source.auditLogs.find(entry => entry.id === auditId);
    if (!validatedBuyerVolumeCredit(request)
      || marker.operationId !== input.operationId || marker.inputFingerprint !== inputFingerprint
      || marker.requestId !== request.id || marker.buyerId !== input.buyerId
      || marker.settledUsdtAmount !== expectedSettledUsdtAmount || marker.creditedUsdtAmount !== creditedUsdtAmount
      || marker.recordedByUserId !== input.actorUserId || marker.reason !== input.reason
      || marker.source !== "owner_attestation" || !audit || audit.purchaseRequestId !== request.id
      || audit.targetUserId !== input.buyerId || audit.actorUserId !== input.actorUserId
      || audit.action !== "admin_override" || audit.listingId !== request.listingId
      || audit.createdAt !== marker.recordedAt || audit.reason !== input.reason
      || !isDeepStrictEqual(audit.oldValue, { kind: "buyer_volume_credit", settledUsdtAmount: expectedSettledUsdtAmount, creditedUsdtAmount: expectedSettledUsdtAmount })
      || !isDeepStrictEqual(audit.newValue, { kind: "buyer_volume_credit", ...marker, additionalVolumeUsdt })) {
      fail("this purchase already has a different or incomplete correction.");
    }
  } else {
    if (source.auditLogs.some(entry => entry.id === auditId)) fail("the operation identity is already used.");
    const time = Date.parse(recordedAt);
    const updatedTime = Date.parse(request.updatedAt);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== recordedAt || !Number.isFinite(updatedTime) || time <= updatedTime) {
      fail("the recording time must follow the existing history.");
    }
  }
  const snapshot = structuredClone(source);
  const target = snapshot.purchaseRequests.find(item => item.id === request.id)!;
  const credit: BuyerVolumeCredit = target.buyerVolumeCredit ?? {
    source: "owner_attestation", operationId: input.operationId, inputFingerprint, requestId: request.id,
    buyerId: input.buyerId, settledUsdtAmount: expectedSettledUsdtAmount, creditedUsdtAmount,
    recordedAt, recordedByUserId: input.actorUserId, reason: input.reason,
  };
  if (!marker) {
    target.buyerVolumeCredit = credit;
    target.updatedAt = recordedAt;
    snapshot.auditLogs.unshift({
      id: auditId, action: "admin_override", actorUserId: input.actorUserId, targetUserId: input.buyerId,
      listingId: request.listingId, purchaseRequestId: request.id, createdAt: recordedAt, reason: input.reason,
      details: "Owner-attested buyer purchase credit. Settled trade amounts, fees, inventory, seller benefits and other buyers remain unchanged.",
      oldValue: { kind: "buyer_volume_credit", settledUsdtAmount: expectedSettledUsdtAmount, creditedUsdtAmount: expectedSettledUsdtAmount },
      newValue: { kind: "buyer_volume_credit", ...credit, additionalVolumeUsdt },
    });
  }
  const buyer = summarizeBuyerPurchases(snapshot.purchaseRequests, input.buyerId, snapshot.sellerReviews);
  return { snapshot, changed: !marker, credit, auditId, summary: {
    buyerId: input.buyerId, requestId: request.id, settledUsdtAmount: expectedSettledUsdtAmount,
    creditedUsdtAmount, additionalVolumeUsdt, ...buyer, buyerRank: getBuyerPrestigeProgress(buyer.lifetimeCompletedVolumeUsdt).rank,
  } };
}
