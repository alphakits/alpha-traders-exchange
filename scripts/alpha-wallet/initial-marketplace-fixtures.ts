import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import type { AssetId } from "../../src/lib/alpha-wallet/amounts";
import { createDurableWallet, initializeDurableWallet } from "../../src/lib/alpha-wallet/durable";
import type { WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { createInitialMarketplaceFixture } from "../../src/lib/alpha-wallet/initial-marketplace-fixture";
import { initializeInitialMarketplaceCoordination } from "../../src/lib/alpha-wallet/initial-marketplace-coordination-store";
import { v2Command } from "../../src/lib/alpha-wallet/v2-commands";
import { createVersionedDurableWallet, upgradeDurableWalletV2 } from "../../src/lib/alpha-wallet/versioned-durable";
import { v3Command } from "../../src/lib/alpha-wallet/v3-commands";
import { createV3DurableWallet, upgradeDurableWalletV3 } from "../../src/lib/alpha-wallet/v3-durable";
import { FIXTURE_TIME, OPERATOR, durableFixture } from "./durable-fixtures";

/**
 * Public synthetic test setup. Explicit real v1/v2 history precedes v3, the
 * canonical database is disposable, and owner cohort activation is separate.
 */
export async function buildInitialMarketplaceFixture(store: WalletStore, options: {
  paymentMethod?: "Bank Transfer" | "Face-to-Face";
  tradeProjection?: "absent" | "pending";
  platform?: "ios" | "android";
  assetId?: AssetId;
  initializeCoordination?: boolean;
} = {}) {
  await initializeDurableWallet(store);
  const canonical = await store.transaction(tx => createInitialMarketplaceFixture({ mode: "simulation-only", tx,
    paymentMethod: options.paymentMethod, tradeProjection: options.tradeProjection, platform: options.platform, assetId: options.assetId }));
  let commandAtMs = FIXTURE_TIME;
  const original = createDurableWallet({ mode: "simulation-only", store, clock: () => ++commandAtMs });
  await durableFixture(original, canonical.assetId).fundedListing("500", canonical.walletListingId);
  const v1 = await original.snapshot();
  await upgradeDurableWalletV2({ mode: "simulation-only", store, acknowledgeVersionUpgrade: true,
    clock: () => ++commandAtMs, command: v2Command("continueFromV1", OPERATOR, "initial-marketplace-continue-v2", {
      checkpoint: { revision: v1.revision, eventHash: v1.eventHash, stateHash: walletDigest(v1.state), lastCommandAtMs: commandAtMs },
    }) });
  const v2 = await createVersionedDurableWallet({ mode: "simulation-only", store }).snapshot();
  await upgradeDurableWalletV3({ mode: "simulation-only", store, acknowledgeVersionUpgrade: true,
    clock: () => ++commandAtMs, command: v3Command("continueFromV2", OPERATOR, "initial-marketplace-continue-v3", {
      checkpoint: { revision: v2.revision, eventHash: v2.eventHash, stateHash: walletDigest(v2.state), lastCommandAtMs: v2.lastCommandAtMs },
    }) });
  const wallet = createV3DurableWallet({ mode: "simulation-only", store, clock: () => canonical.acceptedAtMs });
  const before = await wallet.snapshot();
  if (options.initializeCoordination !== false) {
    await initializeInitialMarketplaceCoordination({ mode: "simulation-only", store, acknowledgeDevelopmentSchema: true });
  }
  return { canonical, wallet, before, v1, v2 };
}
