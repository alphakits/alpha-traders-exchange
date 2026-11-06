import { withDevelopmentPaymentMarketplaceInTransaction } from "../../src/lib/alpha-exchange-repository";
import type { WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import type { DevelopmentPaymentEvidenceUpload } from "../../src/lib/alpha-wallet/payment-marketplace-canonical";
import { createDevelopmentPaymentMarketplaceWalletCoordinator,
  createDevelopmentMobilePaymentMarketplaceWalletCoordinator } from "../../src/lib/alpha-wallet/payment-marketplace-coordinator";
import { buildCancellationMarketplaceFixture, type CancellationMarketplaceFixtureOptions } from "./cancellation-marketplace-fixtures";

/** A fixed one-pixel synthetic PNG. It contains no bank data or payment assertion beyond this disposable fixture. */
export const PAYMENT_MARKETPLACE_SYNTHETIC_EVIDENCE: DevelopmentPaymentEvidenceUpload = Object.freeze({
  mimeType: "image/png",
  contentBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf8sAAAAASUVORK5CYII=",
});
export const PAYMENT_MARKETPLACE_SYNTHETIC_REASON = "The seller has not acknowledged the reported payment.";
export type PaymentMarketplaceFixtureOptions = Omit<CancellationMarketplaceFixtureOptions, "pause"> & {
  upgrade?: boolean; claim?: boolean; dispute?: boolean; pause?: boolean; pausePredecessor?: boolean;
};

/** Original accepted/cancelled V4 cohort, then an explicitly enrolled private V5 profile. */
export async function buildPaymentMarketplaceFixture(store: WalletStore, options: PaymentMarketplaceFixtureOptions = {}) {
  if ((options.claim || options.dispute) && (options.cancel || options.sourcePaused || options.pausePredecessor || options.upgrade === false)) {
    throw new Error("A cancelled, paused or unenrolled fixture cannot authorize a new payment lifecycle action");
  }
  const predecessor = await buildCancellationMarketplaceFixture(store, {
    assetId: options.assetId, paymentMethod: options.paymentMethod, platform: options.platform,
    tradeProjection: options.tradeProjection, cancel: options.cancel, cancelActor: options.cancelActor,
    sourcePaused: options.sourcePaused, pause: options.pausePredecessor,
  });
  predecessor.advanceTime();
  const coordinator = createDevelopmentPaymentMarketplaceWalletCoordinator({ mode: "simulation-only", store, clock: predecessor.clock });
  const mobile = createDevelopmentMobilePaymentMarketplaceWalletCoordinator({ mode: "simulation-only", store, clock: predecessor.clock });
  const { canonical, ownerInput, sellerInput, buyerInput, mobileOwnerInput, mobileSellerInput, mobileBuyerInput } = predecessor;
  const evidence = canonical.initialRequest.paymentMethod === "Bank Transfer" ? PAYMENT_MARKETPLACE_SYNTHETIC_EVIDENCE : undefined;
  const upgrade = options.upgrade === false ? null : await coordinator.upgradeRequest({ ...ownerInput,
    operationId: "payment-fixture-upgrade", acknowledgeVersionUpgrade: true, acknowledgePaymentClaimOnlyProfile: true });
  predecessor.advanceTime();
  const claim = options.claim || options.dispute ? await coordinator.claimPayment({ ...buyerInput,
    operationId: "payment-fixture-claim", ...(evidence ? { evidence } : {}) }) : null;
  if (claim) predecessor.advanceTime();
  const dispute = options.dispute ? await coordinator.openDispute({ ...buyerInput, operationId: "payment-fixture-dispute",
    reason: PAYMENT_MARKETPLACE_SYNTHETIC_REASON }) : null;
  if (dispute) predecessor.advanceTime();
  const pause = options.pause ? await coordinator.pause({ ...ownerInput, operationId: "payment-fixture-pause" }) : null;
  if (pause) predecessor.advanceTime();
  const canonicalSnapshot = await store.transaction(tx => withDevelopmentPaymentMarketplaceInTransaction({
    mode: "simulation-only", tx, requestId: canonical.requestId,
  }, participant => participant.snapshot()));
  return { store, predecessor, canonical, canonicalSnapshot, coordinator, mobile, evidence,
    ownerInput, sellerInput, buyerInput, mobileOwnerInput, mobileSellerInput, mobileBuyerInput,
    clock: predecessor.clock, setTime: predecessor.setTime, advanceTime: predecessor.advanceTime,
    upgrade, claim, dispute, pause };
}
