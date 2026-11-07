import type { AssetId } from "../../src/lib/alpha-wallet/amounts";
import type { WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import {
  createDevelopmentReleaseConsentCoordinator, createDevelopmentMobileReleaseConsentCoordinator,
} from "../../src/lib/alpha-wallet/release-consent-coordinator";
import { verifyReleaseConsentArchive } from "../../src/lib/alpha-wallet/release-consent-model";
import {
  createDevelopmentTrustedPaymentReader, type TrustedPaymentManifestV1,
  type TrustedPaymentObservationV1,
} from "../../src/lib/alpha-wallet/trusted-payment-evidence";
import { v5PaymentClaimKey } from "../../src/lib/alpha-wallet/v5-commands";
import { verifyV5History } from "../../src/lib/alpha-wallet/v5-durable";
import { isV5State } from "../../src/lib/alpha-wallet/v5-engine";
import { buildPaymentMarketplaceFixture } from "./payment-marketplace-fixtures";

export type ReleaseConsentFixtureOptions = {
  assetId?: AssetId;
  paymentMethod?: "Bank Transfer" | "Face-to-Face";
  platform?: "ios" | "android";
  sourceStoreId?: string;
  enroll?: boolean;
};

/**
 * Synthetic source consistency for the actual retained, claimed canonical V5
 * fixture. The unchanged trusted reader derives every binding from database
 * history. These fixtures do not connect to a bank, accept real funds or grant
 * release authority. No old fixture or financial command is modified.
 */
export async function buildReleaseConsentFixture(store: WalletStore, options: ReleaseConsentFixtureOptions = {}) {
  const payment = await buildPaymentMarketplaceFixture(store, {
    assetId: options.assetId, paymentMethod: options.paymentMethod, platform: options.platform, claim: true,
  });
  payment.advanceTime(100);
  const history = () => store.transaction(async tx => (await tx.query(`SELECT revision,command_key,command_type,
    occurred_at_ms::text AS occurred_at_ms,command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
    FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows);
  const originalHistory = await history(), snapshot = verifyV5History(originalHistory);
  if (!isV5State(snapshot.state)) throw new Error("Release-consent fixture requires actual original V5 history");
  const requestId = payment.canonical.requestId;
  const binding = snapshot.state.initialBindings.get(requestId)!;
  const terms = binding.terms, acceptance = snapshot.state.initialAcceptanceReceipts.get(binding.acceptanceKey)!;
  const claim = snapshot.state.initialPaymentClaimReceipts.get(v5PaymentClaimKey(requestId, binding.acceptanceKey))!;
  const bank = terms.paymentMethod === "Bank Transfer", sourceStoreId = options.sourceStoreId ?? "release_fixture_store";
  const sourceId = bank ? "release_fixture_bank_source" : "release_fixture_cash_source";
  const authorityId = bank ? "release_fixture_bank_authority" : "release_fixture_cash_custodian";
  const manifest: TrustedPaymentManifestV1 = {
    kind: "development-trusted-payment-admission", formatVersion: 1, mode: "simulation-only",
    assurance: "synthetic-source-consistency-only",
    sources: [{ sourceId, authorityId, kind: bank ? "synthetic-bank-feed" : "synthetic-independent-cash-custodian",
      enabled: true, validFromMs: acceptance.acceptedAtMs - 1000, validUntilMs: payment.clock() + 3_600_000,
      maxObservationAgeMs: 60_000, recipients: [{ recipientAccountId: "release_fixture_recipient",
        sellerId: terms.sellerId, paymentInstructionsDigest: terms.paymentInstructionsDigest }] }],
  };
  const observation: TrustedPaymentObservationV1 = {
    kind: bank ? "synthetic-bank-credit" : "synthetic-independent-cash-receipt", sourceId, authorityId,
    transactionId: "release_fixture_native_payment", revision: 1, status: "settled",
    occurredAtMs: acceptance.acceptedAtMs + 1, settledAtMs: payment.clock() - 2, observedAtMs: payment.clock() - 1,
    payment: { platformRequestId: terms.platformRequestId, platformTradeId: terms.platformTradeId,
      sellerId: terms.sellerId, buyerId: terms.buyerId, acceptanceKey: acceptance.acceptanceKey, claimKey: claim.claimKey,
      termsDigest: binding.termsDigest, paymentInstructionsDigest: terms.paymentInstructionsDigest,
      recipientAccountId: "release_fixture_recipient", paymentMethod: terms.paymentMethod,
      amountMinor: terms.fiatTotalMinor, currency: "ILS" },
  };
  const prepare = (overrides: Partial<TrustedPaymentObservationV1> = {}) => {
    const captured = structuredClone({ ...observation, ...overrides });
    return createDevelopmentTrustedPaymentReader({ mode: "simulation-only", manifest,
      readWalletHistory: history, readEvidence: () => structuredClone(captured), clock: payment.clock,
    }).prepare({ requestId, sourceId, transactionId: observation.transactionId });
  };
  const coordinatorOptions = { mode: "simulation-only" as const, store, manifest, sourceStoreId, clock: payment.clock };
  const coordinator = createDevelopmentReleaseConsentCoordinator(coordinatorOptions);
  const mobile = createDevelopmentMobileReleaseConsentCoordinator(coordinatorOptions);
  const prepared = await prepare();
  const enrollment = options.enroll === false ? null : await coordinator.enroll({ ...payment.ownerInput,
    operationId: "release_fixture_enrollment", prepared, acknowledgeNonAuthoritativeConsent: true });
  if (enrollment) payment.advanceTime();
  const inspectArchive = () => store.transaction(async tx => {
    const rows = (await tx.query<{ archive_json: unknown }>(
      "SELECT archive_json FROM alpha_wallet_release_consent_simulation.head WHERE singleton")).rows;
    if (rows.length !== 1) throw new Error("Release-consent fixture requires exactly one retained overlay head");
    return verifyReleaseConsentArchive(rows[0]!.archive_json);
  });
  return { store, payment, canonical: payment.canonical, originalHistory, manifest, sourceStoreId, observation,
    prepared, prepare, history, enrollment, coordinator, mobile, inspectArchive, readArchive: inspectArchive,
    ownerInput: payment.ownerInput, sellerInput: payment.sellerInput, buyerInput: payment.buyerInput,
    mobileOwnerInput: payment.mobileOwnerInput, mobileSellerInput: payment.mobileSellerInput,
    mobileBuyerInput: payment.mobileBuyerInput, clock: payment.clock, advanceTime: payment.advanceTime, setTime: payment.setTime };
}
