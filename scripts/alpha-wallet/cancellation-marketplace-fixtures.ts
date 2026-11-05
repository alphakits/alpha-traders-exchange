import { withDevelopmentCancellationMarketplaceInTransaction } from "../../src/lib/alpha-exchange-repository";
import type { AssetId } from "../../src/lib/alpha-wallet/amounts";
import {
  createDevelopmentCancellationMarketplaceWalletCoordinator,
  createDevelopmentMobileCancellationMarketplaceWalletCoordinator,
} from "../../src/lib/alpha-wallet/cancellation-marketplace-coordinator";
import type { WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { createDevelopmentInitialMarketplaceWalletCoordinator } from "../../src/lib/alpha-wallet/initial-marketplace-coordinator";
import { buildInitialMarketplaceFixture } from "./initial-marketplace-fixtures";

export type CancellationMarketplaceFixtureOptions = {
  assetId?: AssetId;
  paymentMethod?: "Bank Transfer" | "Face-to-Face";
  platform?: "ios" | "android";
  tradeProjection?: "absent" | "pending";
  cancel?: boolean;
  cancelActor?: "buyer" | "seller";
  pause?: boolean;
  /** Pause the original accepted V3 cohort before its explicit V4 upgrade. */
  sourcePaused?: boolean;
};

/**
 * Public synthetic credentials and disposable canonical/database records only.
 * Builds real V1/V2/V3 history, authenticated initial acceptance, then the explicit
 * current-owner cancellation successor upgrade. Nothing here sends or signs.
 */
export async function buildCancellationMarketplaceFixture(store: WalletStore,
  options: CancellationMarketplaceFixtureOptions = {}) {
  if (options.sourcePaused && options.cancel) throw new Error("A paused source cannot authorize a new cancellation");
  const source = await buildInitialMarketplaceFixture(store, options);
  const { canonical } = source;
  let now = canonical.acceptedAtMs;
  const clock = () => now;
  const setTime = (atMs: number) => { now = atMs; };
  const advanceTime = (milliseconds = 1) => { now += milliseconds; return now; };
  const ownerInput = { sessionToken: canonical.ownerSessionToken, requestId: canonical.requestId };
  const sellerInput = { sessionToken: canonical.sellerSessionToken, requestId: canonical.requestId };
  const buyerInput = { sessionToken: canonical.buyerSessionToken, requestId: canonical.requestId };
  const mobileOwnerInput = { ...canonical.mobile.credentials[canonical.ownerId], requestId: canonical.requestId };
  const mobileSellerInput = { ...canonical.mobile.credentials[canonical.sellerId], requestId: canonical.requestId };
  const mobileBuyerInput = { ...canonical.mobile.credentials[canonical.buyerId], requestId: canonical.requestId };
  const initial = createDevelopmentInitialMarketplaceWalletCoordinator({ mode: "simulation-only", store, clock });
  const activation = await initial.activateRequest({ ...ownerInput, operationId: "cancellation-fixture-activation",
    assetId: canonical.assetId, walletListingId: canonical.walletListingId, walletTradeId: canonical.walletTradeId });
  const acceptance = await initial.acceptRequest({ ...sellerInput, operationId: "cancellation-fixture-acceptance",
    ...(canonical.initialRequest.paymentMethod === "Bank Transfer" ? {} : { safetyAcknowledged: true as const }) });
  advanceTime();
  const sourcePause = options.sourcePaused
    ? await initial.pause({ ...ownerInput, operationId: "cancellation-fixture-source-pause" }) : null;
  if (sourcePause) advanceTime();
  const coordinator = createDevelopmentCancellationMarketplaceWalletCoordinator({ mode: "simulation-only", store, clock });
  const mobile = createDevelopmentMobileCancellationMarketplaceWalletCoordinator({ mode: "simulation-only", store, clock });
  const upgrade = await coordinator.upgradeRequest({ ...ownerInput, operationId: "cancellation-fixture-upgrade",
    acknowledgeVersionUpgrade: true });
  advanceTime();
  const cancellation = options.cancel ? await coordinator.cancelRequest({
    ...(options.cancelActor === "buyer" ? buyerInput : sellerInput), operationId: "cancellation-fixture-cancel",
  }) : null;
  if (cancellation) advanceTime();
  const pause = options.pause ? await coordinator.pause({ ...ownerInput, operationId: "cancellation-fixture-pause" }) : null;
  if (pause) advanceTime();
  const canonicalSnapshot = await store.transaction(tx => withDevelopmentCancellationMarketplaceInTransaction({
    mode: "simulation-only", tx, requestId: canonical.requestId,
  }, participant => participant.snapshot()));
  return { store, source, canonical, canonicalSnapshot, initial, coordinator, mobile,
    clock, setTime, advanceTime, ownerInput, sellerInput, buyerInput,
    mobileOwnerInput, mobileSellerInput, mobileBuyerInput,
    activation, acceptance, sourcePause, upgrade, cancellation, pause };
}
