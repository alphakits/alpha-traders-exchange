import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import type { WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { balance } from "../../src/lib/alpha-wallet/ledger";
import { cancellationPlannerDigest, v4Command, v4CancellationKey, type V4InitialCancellationInput } from "../../src/lib/alpha-wallet/v4-commands";
import { createV4DurableWallet, upgradeDurableWalletV4, type V4WalletSnapshot } from "../../src/lib/alpha-wallet/v4-durable";
import { isV4State } from "../../src/lib/alpha-wallet/v4-engine";
import { OPERATOR, SELLER } from "./durable-fixtures";
import { buildV3AcceptanceFixture, V3_FIXTURE_REQUEST, v3FixtureCheckpoint } from "./v3-durable-fixtures";

/** Synthetic financial assertions only; never evidence of canonical consent. */
export function v4FixtureCancellationInput(snapshot: V4WalletSnapshot, at: number, actorUserId = SELLER.id): V4InitialCancellationInput {
  if (!isV4State(snapshot.state)) throw new Error("Fixture requires V4");
  const state = snapshot.state, binding = state.initialBindings.get(V3_FIXTURE_REQUEST)!;
  const accepted = state.initialAcceptanceReceipts.get(binding.acceptanceKey)!;
  const terms = structuredClone(binding.terms);
  const input: V4InitialCancellationInput = {
    cancellationKey: v4CancellationKey(terms.platformRequestId, accepted.acceptanceKey), terms, termsDigest: binding.termsDigest,
    originalAcceptance: { acceptanceKey: accepted.acceptanceKey, commandRevision: accepted.commandRevision,
      commandKey: accepted.commandKey, receiptDigest: walletDigest(accepted), bindingDigest: walletDigest(binding) },
    cancelledAtMs: at,
    preconditions: { requestUpdatedAt: new Date(accepted.acceptedAtMs).toISOString(),
      requestDigest: walletDigest(["synthetic-accepted-request", terms.platformRequestId]),
      listingDigest: walletDigest(["synthetic-locked-listing", terms.platformListingId]),
      tradeDigest: walletDigest(["synthetic-accepted-trade", terms.platformTradeId]),
      marketplaceDigest: walletDigest(["synthetic-prepayment-basis", terms.platformRequestId]),
      listingExpiresAt: null, canonicalPrepayment: true, canonicalTermsUnchanged: true, buyerBankDetailsDisclosed: false,
      walletRevision: snapshot.revision, walletEventHash: snapshot.eventHash, walletStateDigest: walletDigest(state),
      walletTradeDigest: walletDigest(state.trades.get(binding.walletTradeId)),
      walletListingDigest: walletDigest(state.listings.get(binding.walletListingId)) },
    principalReturn: { action: "return_to_listing", assetId: terms.assetId, walletListingId: binding.walletListingId,
      walletTradeId: binding.walletTradeId, principalRaw: terms.principalRaw, transferAmountRaw: terms.principalRaw,
      fromAccount: `trade:${binding.walletTradeId}`, toAccount: `listing:${binding.walletListingId}`,
      expectedListingAvailableRaw: balance(state, terms.assetId, `listing:${binding.walletListingId}`).toString(),
      expectedTradeReservedRaw: terms.principalRaw },
    plannerInputDigest: "0".repeat(64),
  };
  input.plannerInputDigest = cancellationPlannerDigest(input, actorUserId);
  return input;
}

export async function buildV4CancellationFixture(store: WalletStore, options: {
  cancel?: boolean; pause?: boolean; sourcePaused?: boolean; unknownWithdrawal?: boolean;
} = {}) {
  const original = await buildV3AcceptanceFixture(store, { pause: options.sourcePaused, unknownWithdrawal: options.unknownWithdrawal });
  let at = original.now();
  const command = v4Command("continueFromV3", OPERATOR, "v4-fixture-continue", { checkpoint: v3FixtureCheckpoint(original.snapshot) });
  const continuation = await upgradeDurableWalletV4({ mode: "simulation-only", store, command,
    acknowledgeVersionUpgrade: true, clock: () => ++at });
  const wallet = createV4DurableWallet({ mode: "simulation-only", store, clock: () => ++at });
  const before = await wallet.snapshot();
  const cancellation = v4Command("cancelInitialTrade", SELLER, "v4-fixture-cancel", v4FixtureCancellationInput(before, at + 1));
  const execution = options.cancel === false ? undefined : await wallet.execute(cancellation);
  if (options.pause) await wallet.execute(v4Command("pause", OPERATOR, "v4-fixture-source-pause", null));
  return { original, command, continuation, wallet, before, cancellation, execution, snapshot: await wallet.snapshot(), now: () => at };
}
