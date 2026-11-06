import { createHash } from "node:crypto";
import { walletDigest } from "../../src/lib/alpha-wallet/commands";
import type { WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { balance } from "../../src/lib/alpha-wallet/ledger";
import { disputeFreezePlannerDigest, paymentClaimPlannerDigest, v5Command, v5DisputeFreezeKey, v5PaymentClaimKey,
  type V5InitialDisputeFreezeInput, type V5InitialPaymentClaimInput } from "../../src/lib/alpha-wallet/v5-commands";
import { createV5DurableWallet, upgradeDurableWalletV5, type V5WalletSnapshot } from "../../src/lib/alpha-wallet/v5-durable";
import { isV5State } from "../../src/lib/alpha-wallet/v5-engine";
import { OPERATOR } from "./durable-fixtures";
import { V3_FIXTURE_REQUEST, v3FixtureCheckpoint } from "./v3-durable-fixtures";
import { buildV4CancellationFixture } from "./v4-durable-fixtures";

/** Synthetic assertion builder only. These digests do not establish canonical reads, authentication or proof bytes. */
function basis(snapshot: V5WalletSnapshot, requestId = V3_FIXTURE_REQUEST) {
  if (!isV5State(snapshot.state)) throw new Error("Fixture requires explicit V5");
  const state = snapshot.state, binding = state.initialBindings.get(requestId)!;
  const accepted = state.initialAcceptanceReceipts.get(binding.acceptanceKey)!;
  return { state, binding, accepted, input: {
    terms: structuredClone(binding.terms), termsDigest: binding.termsDigest,
    originalAcceptance: { acceptanceKey: accepted.acceptanceKey, commandRevision: accepted.commandRevision, commandKey: accepted.commandKey,
      receiptDigest: walletDigest(accepted), bindingDigest: walletDigest(binding) },
    preconditions: { requestUpdatedAt: new Date(accepted.acceptedAtMs).toISOString(),
      requestDigest: walletDigest(["synthetic-request", requestId]), listingDigest: walletDigest(["synthetic-listing", binding.platformListingId]),
      tradeDigest: walletDigest(["synthetic-trade", binding.platformTradeId]), marketplaceDigest: walletDigest(["synthetic-lifecycle", requestId]),
      canonicalStatus: "accepted" as "accepted" | "payment_sent", canonicalTermsUnchanged: true as const, canonicalOpenDispute: false as const,
      walletRevision: snapshot.revision, walletEventHash: snapshot.eventHash, walletStateDigest: walletDigest(state),
      walletTradeDigest: walletDigest(state.trades.get(binding.walletTradeId)), walletListingDigest: walletDigest(state.listings.get(binding.walletListingId)) },
    principalHold: { action: "retain_reserved" as const, assetId: binding.assetId, walletListingId: binding.walletListingId,
      walletTradeId: binding.walletTradeId, principalRaw: binding.terms.principalRaw, transferAmountRaw: "0" as const,
      expectedTradeReservedRaw: binding.terms.principalRaw,
      expectedListingAvailableRaw: balance(state, binding.assetId, `listing:${binding.walletListingId}`).toString() },
    plannerInputDigest: "0".repeat(64),
  } };
}
export function v5FixtureClaimInput(snapshot: V5WalletSnapshot, at: number, requestId = V3_FIXTURE_REQUEST): V5InitialPaymentClaimInput {
  const { input: shared, binding } = basis(snapshot, requestId);
  const input: V5InitialPaymentClaimInput = { ...shared, claimKey: v5PaymentClaimKey(requestId, binding.acceptanceKey), claimedAtMs: at,
    claim: { kind: "buyer_payment_claim", buyerId: binding.terms.buyerId, amountMinor: binding.terms.fiatTotalMinor, currency: "ILS",
      proof: binding.terms.paymentMethod === "Bank Transfer" ? { evidenceId: "v5-synthetic-buyer-proof",
        contentSha256: createHash("sha256").update("synthetic proof bytes").digest("hex"), mimeType: "image/png", sizeBytes: 21 } : null } };
  input.plannerInputDigest = paymentClaimPlannerDigest(input, binding.terms.buyerId); return input;
}
export function v5FixtureDisputeInput(snapshot: V5WalletSnapshot, at: number, requestId = V3_FIXTURE_REQUEST): V5InitialDisputeFreezeInput {
  const { input: shared, state, binding } = basis(snapshot, requestId);
  const claim = state.initialPaymentClaimReceipts.get(v5PaymentClaimKey(requestId, binding.acceptanceKey));
  if (!claim) throw new Error("Fixture requires the exact buyer claim first");
  const input: V5InitialDisputeFreezeInput = { ...shared, disputeKey: v5DisputeFreezeKey(requestId, binding.acceptanceKey), disputedAtMs: at,
    reasonDigest: createHash("sha256").update("Synthetic buyer dispute reason").digest("hex"),
    priorClaim: { claimKey: claim.claimKey, commandRevision: claim.commandRevision, receiptDigest: walletDigest(claim) } };
  input.preconditions.canonicalStatus = "payment_sent"; input.preconditions.requestUpdatedAt = new Date(claim.claimedAtMs).toISOString();
  input.plannerInputDigest = disputeFreezePlannerDigest(input, binding.terms.buyerId); return input;
}
export async function buildV5PaymentFixture(store: WalletStore, options: {
  claim?: boolean; dispute?: boolean; pause?: boolean; cancelledSource?: boolean; sourcePaused?: boolean; unknownWithdrawal?: boolean;
} = {}) {
  const original = await buildV4CancellationFixture(store, { cancel: options.cancelledSource ?? false, pause: options.sourcePaused,
    unknownWithdrawal: options.unknownWithdrawal });
  let at = original.now();
  const command = v5Command("continueFromV4", OPERATOR, "v5-fixture-continue", { checkpoint: v3FixtureCheckpoint(original.snapshot) });
  const continuation = await upgradeDurableWalletV5({ mode: "simulation-only", store, command,
    acknowledgeVersionUpgrade: true, acknowledgePaymentClaimOnlyProfile: true, clock: () => ++at });
  const wallet = createV5DurableWallet({ mode: "simulation-only", store, clock: () => ++at });
  const before = await wallet.snapshot(), claimInput = v5FixtureClaimInput(before, at + 1);
  const buyer = { kind: "buyer" as const, id: claimInput.terms.buyerId };
  const claimCommand = v5Command("claimInitialPayment", buyer, "v5-fixture-claim", claimInput);
  const claim = options.claim === false ? undefined : await wallet.execute(claimCommand);
  const afterClaim = await wallet.snapshot();
  const disputeCommand = claim ? v5Command("freezeInitialDispute", buyer, "v5-fixture-dispute", v5FixtureDisputeInput(afterClaim, at + 1)) : undefined;
  const dispute = options.dispute && disputeCommand ? await wallet.execute(disputeCommand) : undefined;
  if (options.pause) await wallet.execute(v5Command("pause", OPERATOR, "v5-fixture-pause", null));
  return { original, command, continuation, wallet, before, buyer, claimCommand, claim, afterClaim, disputeCommand, dispute,
    snapshot: await wallet.snapshot(), now: () => at };
}
