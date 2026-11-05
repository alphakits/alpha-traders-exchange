import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import { createDurableWallet, initializeDurableWallet, walletCommand } from "../../src/lib/alpha-wallet/durable";
import type { WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { createMarketplaceCoordinationFixture } from "../../src/lib/alpha-wallet/marketplace-coordination-fixture";
import { initializeMarketplaceCoordination } from "../../src/lib/alpha-wallet/marketplace-coordination-store";
import { createDevelopmentMarketplaceWalletCoordinator } from "../../src/lib/alpha-wallet/marketplace-coordinator";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { simulatedDestination } from "../../src/lib/alpha-wallet/sandbox";
import { v2Command } from "../../src/lib/alpha-wallet/v2-commands";
import { upgradeDurableWalletV2 } from "../../src/lib/alpha-wallet/versioned-durable";
import { BUYER, FIXTURE_TIME, OPERATOR, TRON, durableFixture } from "./durable-fixtures";

export const MARKETPLACE_BACKUP_RESTORE_TIME = FIXTURE_TIME + 10_000;

/**
 * A disposable development fixture shared by local and native recovery drills.
 * Uses the actual canonical participant, fixed stored web sessions and the typed
 * coordinator. It creates no account, provider, worker or external connection.
 * Its caller owns and has already selected the isolated WalletStore.
 */
export async function marketplaceBackupFixture(store: WalletStore, options: {
  paymentMethod?: "Bank Transfer" | "Face-to-Face";
  acceptCorrection?: boolean;
  pause?: boolean;
} = {}) {
  assertSimulationRuntime("simulation-only");
  await initializeDurableWallet(store);
  const fixture = await store.transaction(tx => createMarketplaceCoordinationFixture({
    mode: "simulation-only", tx, paymentMethod: options.paymentMethod,
  }));
  let now = FIXTURE_TIME + 1000;
  const clock = () => now;
  const wallet = createDurableWallet({ mode: "simulation-only", store, clock: () => FIXTURE_TIME });
  await durableFixture(wallet).fundedListing("500", fixture.listingId);
  await wallet.execute(walletCommand("reserveTrade", BUYER, "combined-backup-reserve", {
    id: fixture.tradeId, listingId: fixture.listingId, amount: "200",
    destination: simulatedDestination(TRON, BUYER.id),
  }));
  const previous = await wallet.snapshot();
  await upgradeDurableWalletV2({
    mode: "simulation-only", store, acknowledgeVersionUpgrade: true, clock: () => FIXTURE_TIME,
    command: v2Command("continueFromV1", OPERATOR, "combined-backup-upgrade", {
      checkpoint: {
        revision: previous.revision, eventHash: previous.eventHash,
        stateHash: walletDigest(previous.state), lastCommandAtMs: FIXTURE_TIME,
      },
    }),
  });
  await initializeMarketplaceCoordination({ mode: "simulation-only", store, acknowledgeDevelopmentSchema: true });
  const coordinator = createDevelopmentMarketplaceWalletCoordinator({ mode: "simulation-only", store, clock });
  const ownerInput = { sessionToken: fixture.ownerSessionToken, requestId: fixture.requestId };
  const enrollmentInput = {
    ...ownerInput, walletListingId: fixture.listingId, walletTradeId: fixture.tradeId,
    assetId: TRON, operationId: "combined-backup-enroll",
  };
  const acceptanceInput = {
    sessionToken: fixture.buyerSessionToken, requestId: fixture.requestId,
    proposalId: fixture.proposalId, expectedBindingRevision: 0, operationId: "combined-backup-accept",
  };
  const enrolled = await coordinator.enrollReservedTrade(enrollmentInput);
  const accepted = options.acceptCorrection === false ? null : await coordinator.acceptAmountCorrection(acceptanceInput);
  const paused = options.pause === false ? null : await coordinator.pause({ ...ownerInput, operationId: "combined-backup-source-pause" });
  return {
    fixture, coordinator, clock, ownerInput, enrollmentInput, acceptanceInput, enrolled, accepted, paused,
    setTime(at: number) { now = at; },
  };
}

export type MarketplaceBackupFixture = Awaited<ReturnType<typeof marketplaceBackupFixture>>;
