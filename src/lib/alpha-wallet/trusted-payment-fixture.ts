import { BUYER, OPERATOR } from "../../../scripts/alpha-wallet/durable-fixtures";
import { V3_FIXTURE_REQUEST } from "../../../scripts/alpha-wallet/v3-durable-fixtures";
import { v5FixtureClaimInput, v5FixtureDisputeInput } from "../../../scripts/alpha-wallet/v5-durable-fixtures";
import { createV5EngineFixture } from "../../../scripts/alpha-wallet/v5-engine-fixtures";
import type { AssetId } from "./amounts";
import { assertSimulationRuntime } from "./runtime";
import { createDevelopmentTrustedPaymentReader, type DevelopmentTrustedPaymentReaderOptions,
  type TrustedPaymentManifestV1, type TrustedPaymentObservationStatus, type TrustedPaymentObservationV1 } from "./trusted-payment-evidence";
import { v5Command, v5PaymentClaimKey } from "./v5-commands";

/** Isolated synthetic test data, not a bank connection, cash attestation or user authorization. */
export function createTrustedPaymentFixture(options: {
  method?: "Bank Transfer" | "Face-to-Face (Meet in Person)";
  assetId?: AssetId; amount?: string; status?: TrustedPaymentObservationStatus; disputed?: boolean; paused?: boolean;
} = {}) {
  assertSimulationRuntime("simulation-only");
  const wallet = createV5EngineFixture({ method: options.method, assetId: options.assetId, amount: options.amount });
  wallet.step(v5Command("claimInitialPayment", BUYER, "fiat-fixture-buyer-claim", v5FixtureClaimInput(wallet.snapshot(), wallet.at + 1)));
  if (options.disputed) wallet.step(v5Command("freezeInitialDispute", BUYER, "fiat-fixture-dispute", v5FixtureDisputeInput(wallet.snapshot(), wallet.at + 1)));
  if (options.paused) wallet.step(v5Command("pause", OPERATOR, "fiat-fixture-pause", null));
  const binding = wallet.state.initialBindings.get(V3_FIXTURE_REQUEST)!, terms = binding.terms;
  const accepted = wallet.state.initialAcceptanceReceipts.get(binding.acceptanceKey)!;
  const claim = wallet.state.initialPaymentClaimReceipts.get(v5PaymentClaimKey(V3_FIXTURE_REQUEST, binding.acceptanceKey))!;
  const bank = terms.paymentMethod === "Bank Transfer", sourceId = bank ? "fixture-bank-source" : "fixture-cash-source";
  const authorityId = bank ? "fixture-bank-authority" : "fixture-cash-custodian";
  let now = wallet.at + 100;
  const manifest: TrustedPaymentManifestV1 = {
    kind: "development-trusted-payment-admission", formatVersion: 1, mode: "simulation-only", assurance: "synthetic-source-consistency-only",
    sources: [{ sourceId, authorityId, kind: bank ? "synthetic-bank-feed" : "synthetic-independent-cash-custodian",
      enabled: true, validFromMs: accepted.acceptedAtMs - 1000, validUntilMs: now + 3_600_000, maxObservationAgeMs: 60_000,
      recipients: [{ recipientAccountId: "fixture-recipient-account", sellerId: terms.sellerId, paymentInstructionsDigest: terms.paymentInstructionsDigest }] }],
  };
  const status = options.status ?? "settled";
  const observation: TrustedPaymentObservationV1 = {
    kind: bank ? "synthetic-bank-credit" : "synthetic-independent-cash-receipt", sourceId, authorityId,
    transactionId: "fixture-payment-transaction", revision: 1, status, occurredAtMs: accepted.acceptedAtMs + 1,
    settledAtMs: status === "settled" || status === "reversed" ? now - 2 : null, observedAtMs: now - 1,
    payment: { platformRequestId: terms.platformRequestId, platformTradeId: terms.platformTradeId,
      sellerId: terms.sellerId, buyerId: terms.buyerId, acceptanceKey: accepted.acceptanceKey, claimKey: claim.claimKey,
      termsDigest: binding.termsDigest, paymentInstructionsDigest: terms.paymentInstructionsDigest,
      recipientAccountId: "fixture-recipient-account", paymentMethod: terms.paymentMethod, amountMinor: terms.fiatTotalMinor, currency: "ILS" },
  };
  const request = { requestId: V3_FIXTURE_REQUEST, sourceId, transactionId: observation.transactionId };
  const readerOptions = (): DevelopmentTrustedPaymentReaderOptions => ({ mode: "simulation-only", manifest,
    readWalletHistory: () => structuredClone(wallet.records), readEvidence: () => structuredClone(observation), clock: () => now });
  return { wallet, manifest, observation, request, readerOptions,
    reader: () => createDevelopmentTrustedPaymentReader(readerOptions()),
    now: () => now, setNow: (value: number) => { now = value; } };
}
