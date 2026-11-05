/**
 * One-time capture of already-verified, unchanged v2 semantics.
 *
 * NODE_ENV=test node --conditions=react-server --import tsx \
 *   scripts/alpha-wallet/capture-v2-history-fixture.ts --capture-frozen-v2-history
 *
 * This opens only a fresh temporary PGlite directory. Before opening it, every
 * listed source is compared byte-for-byte with the verified Git object. Existing
 * fixture files are never overwritten. Tests do not import or run this script.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { planAcceptedAmountTerms } from "../../src/lib/alpha-wallet/accepted-terms";
import { assetFor, parseUnits, type AssetId } from "../../src/lib/alpha-wallet/amounts";
import { walletDigest, walletJson, type WalletCommandType, type CommandOf } from "../../src/lib/alpha-wallet/commands";
import { createDurableWallet, initializeDurableWallet, walletCommand } from "../../src/lib/alpha-wallet/durable";
import { createFileWalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { assertLedgerInvariants, balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { simulatedDestination } from "../../src/lib/alpha-wallet/sandbox";
import type { Actor, State } from "../../src/lib/alpha-wallet/types";
import { acceptanceInputFromPlan, v2Command, type V2CommandType, type V2CommandOf } from "../../src/lib/alpha-wallet/v2-commands";
import { assertV2Invariants, isV2State, planningBindingFor } from "../../src/lib/alpha-wallet/v2-engine";
import { createV2TermsFixture } from "../../src/lib/alpha-wallet/v2-fixtures";
import { exportVersionedWalletBackup } from "../../src/lib/alpha-wallet/versioned-backup";
import { createVersionedDurableWallet, upgradeDurableWalletV2, verifyVersionedHistory } from "../../src/lib/alpha-wallet/versioned-durable";

const SOURCE_COMMIT = "47f0fc18f33c0f307da53726281db18055a76855";
const SOURCE_TREE = "eea3bee815707d3fc62a0d68c69d301bad0ab079";
const ROOT = resolve(import.meta.dirname, "../..");
const OUTPUT = join(ROOT, "src/lib/alpha-wallet/fixtures/v2");
const SOURCE_PATHS = [
  "src/lib/alpha-wallet/amounts.ts", "src/lib/alpha-wallet/backup.ts", "src/lib/alpha-wallet/commands.ts",
  "src/lib/alpha-wallet/durable-store.ts", "src/lib/alpha-wallet/durable.ts", "src/lib/alpha-wallet/ledger.ts",
  "src/lib/alpha-wallet/runtime.ts", "src/lib/alpha-wallet/sandbox.ts", "src/lib/alpha-wallet/types.ts",
  "src/lib/alpha-wallet/accepted-terms.ts", "src/lib/alpha-wallet/v2-commands.ts", "src/lib/alpha-wallet/v2-engine.ts",
  "src/lib/alpha-wallet/v2-kernel.ts", "src/lib/alpha-wallet/v2-fixtures.ts", "src/lib/alpha-wallet/versioned-durable.ts",
  "src/lib/alpha-wallet/versioned-projections.ts", "src/lib/alpha-wallet/versioned-backup.ts",
  "src/lib/alpha-wallet/payout-worker.ts", "src/lib/alpha-wallet/versioned-payout-worker.ts",
  "src/lib/trade-amount-lock.ts", "src/lib/trade-cancellation.ts", "src/lib/usdt-demand-policy.ts",
  "src/lib/marketplace-payment-methods.ts", "src/types/alpha-exchange.ts",
  "packages/contracts/src/index.ts", "packages/contracts/src/trade-terms.ts", "packages/contracts/src/trade-amount.ts",
  "packages/contracts/src/commission-amount.ts", "packages/contracts/src/marketplace-fees.ts",
  "packages/contracts/src/cardless-withdrawal.ts", "packages/contracts/src/price-offer.ts",
  "docs/alpha-wallet/durable-schema.sql", "docs/alpha-wallet/durable-v2-migration.sql",
] as const;
const NAMES = ["corrections-and-settlement.backup.json", "corrections-and-settlement.state.json", "provenance.json"] as const;
const START = Date.parse("2026-11-05T12:00:00.000Z");
const STEP = 1_000;
const SELLER: Actor = { kind: "seller", id: "frozen-v2-seller" };
const BUYER: Actor = { kind: "buyer", id: "frozen-v2-buyer" };
const OWNER: Actor = { kind: "operator", id: "frozen-v2-owner" };
const VERIFIER: Actor = { kind: "verifier", id: "frozen-v2-verifier" };
const DISPATCHER: Actor = { kind: "dispatcher", id: "frozen-v2-dispatcher" };
const TRON = "tron-sim-usdt", BSC = "bsc-sim-binance-peg-usdt";
const TRON_LISTING = "frozen-v2-tron-listing", BSC_LISTING = "frozen-v2-bsc-listing";
const TRON_TRADE = "frozen-v2-tron-trade", BSC_TRADE = "frozen-v2-bsc-trade";
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const checkpoint = (snapshot: { revision: number; eventHash: string; state: State; occurredAtMs: number }) => ({
  revision: snapshot.revision, eventHash: snapshot.eventHash, stateHash: walletDigest(snapshot.state), lastCommandAtMs: snapshot.occurredAtMs,
});

async function main() {
  assert.deepEqual(process.argv.slice(2), ["--capture-frozen-v2-history"], "Explicit one-time fixture capture is required");
  assertSimulationRuntime("simulation-only");
  assert.equal(process.cwd(), ROOT, "Run from the repository root so the guarded schema paths are exact");
  for (const name of NAMES) assert(!existsSync(join(OUTPUT, name)), "Frozen evidence already exists; never regenerate expectations to make a changed engine pass");
  assert.equal(execFileSync("git", ["rev-parse", `${SOURCE_COMMIT}^{tree}`], { cwd: ROOT, encoding: "utf8" }).trim(), SOURCE_TREE);
  const sourceSha256: Record<string, string> = {};
  for (const path of SOURCE_PATHS) {
    const verified = execFileSync("git", ["show", `${SOURCE_COMMIT}:${path}`], { cwd: ROOT });
    const current = readFileSync(join(ROOT, path));
    assert(verified.equals(current), `Refusing capture from changed verified source: ${path}`);
    sourceSha256[path] = hash(verified);
  }
  const checkoutAtCapture = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const directory = await mkdtemp(join(tmpdir(), "alpha-wallet-frozen-v2-capture-"));
  const store = await createFileWalletStore({ mode: "simulation-only", dataDir: join(directory, "source") });
  try {
    await initializeDurableWallet(store);
    let now = START;
    const clock = () => now += STEP;
    const v1 = createDurableWallet({ mode: "simulation-only", store, clock });
    const old = <T extends WalletCommandType>(type: T, actor: Actor, requestId: string, input: CommandOf<T>["input"]) =>
      v1.execute(walletCommand(type, actor, requestId, input));
    async function fund(assetId: AssetId, amount: string, id: string) {
      const intent = await old("createDepositIntent", SELLER, `${id}-intent`, { id, assetId, purpose: "principal" });
      const asset = assetFor(assetId);
      await old("observeDeposit", VERIFIER, `${id}-credit`, { intentId: id, assetId, network: asset.network, token: asset.token,
        transactionId: `sim-tx-${id}`, eventIndex: 0, destination: intent.result.destination,
        amountRaw: parseUnits(amount, asset.decimals).toString(), blockHash: "sim-block-frozen-v2", finalized: true, successful: true });
    }
    await fund(TRON, "600", "frozen-v2-tron-funding");
    await old("createListing", SELLER, "frozen-v2-tron-create", { id: TRON_LISTING, assetId: TRON, amount: "500", price: "3.20", currency: "ILS" });
    await old("approveListing", OWNER, "frozen-v2-tron-approve", TRON_LISTING);
    await old("reserveTrade", BUYER, "frozen-v2-tron-original-reserve", { id: TRON_TRADE, listingId: TRON_LISTING,
      amount: "200", destination: simulatedDestination(TRON, BUYER.id) });
    await fund(BSC, "10", "frozen-v2-bsc-funding");
    await old("createListing", SELLER, "frozen-v2-bsc-create", { id: BSC_LISTING, assetId: BSC, amount: "10", price: "3.20", currency: "ILS" });
    await old("approveListing", OWNER, "frozen-v2-bsc-approve", BSC_LISTING);
    await old("reserveTrade", BUYER, "frozen-v2-bsc-original-reserve", { id: BSC_TRADE, listingId: BSC_LISTING,
      amount: "1.00005", destination: simulatedDestination(BSC, BUYER.id) });
    await old("reconcileAsset", VERIFIER, "frozen-v2-tron-original-reconcile", { assetId: TRON, observedRaw: "600000000", complete: true });
    await old("setNativeFeeReadiness", OWNER, "frozen-v2-tron-original-gas", { assetId: TRON, ready: true });
    const withdrawal = await old("requestWithdrawal", SELLER, "frozen-v2-original-withdrawal", { id: "frozen-v2-held-withdrawal",
      assetId: TRON, amount: "25", destination: simulatedDestination(TRON, SELLER.id), stepUpReference: "sim-stepup-frozen-v2" });
    await old("beginDispatch", DISPATCHER, "frozen-v2-original-dispatch", withdrawal.result.id);
    await old("recordSubmission", DISPATCHER, "frozen-v2-original-unknown", { payoutId: withdrawal.result.id, outcome: "unknown" });
    const prefix = await v1.snapshot();
    const prefixCheckpoint = checkpoint({ ...prefix, occurredAtMs: now });
    const continuation = await upgradeDurableWalletV2({ mode: "simulation-only", store,
      command: v2Command("continueFromV1", OWNER, "frozen-v2-continuation", { checkpoint: prefixCheckpoint }),
      acknowledgeVersionUpgrade: true, clock });
    const wallet = createVersionedDurableWallet({ mode: "simulation-only", store, clock });
    const next = <T extends V2CommandType>(type: T, actor: Actor, requestId: string, input: V2CommandOf<T>["input"]) =>
      wallet.execute(v2Command(type, actor, requestId, input));
    const correctionFacts: Array<Record<string, unknown>> = [];
    async function correction(tradeId: string, amount: string, count: 1 | 2, label: string, enroll: boolean) {
      const current = await wallet.snapshot();
      const fixture = createV2TermsFixture({ mode: "simulation-only", state: current.state, walletTradeId: tradeId,
        platformRequestId: `frozen-v2-request-${tradeId === TRON_TRADE ? "tron" : "bsc"}`,
        platformListingId: `frozen-v2-platform-${tradeId === TRON_TRADE ? "tron" : "bsc"}`,
        proposalId: `frozen-v2-proposal-${label}`, proposedAmount: amount, submittedAdjustmentCount: count,
        at: new Date(now).toISOString() });
      if (enroll) await next("enrollReservedTrade", OWNER, `frozen-v2-enroll-${label}`, { walletTradeId: tradeId,
        terms: fixture.description.terms, termsDigest: fixture.description.digest, expectedWallet: checkpoint(current),
        walletTradeDigest: walletDigest(current.state.trades.get(tradeId)) });
      const before = await wallet.snapshot();
      assert(isV2State(before.state));
      const binding = planningBindingFor(before.state, fixture.request.id);
      const plan = planAcceptedAmountTerms({ mode: "simulation-only", actorUserId: BUYER.id, requestId: fixture.request.id,
        proposalId: fixture.proposalId, expectedBindingRevision: binding.revision, binding,
        marketplace: fixture.marketplace, wallet: before });
      const execution = await next("acceptAmountCorrection", BUYER, `frozen-v2-accept-${label}`, acceptanceInputFromPlan(plan));
      correctionFacts.push({ label, requestId: fixture.request.id, proposalId: fixture.proposalId,
        action: plan.reservation.action, priorCheckpoint: checkpoint(before), revision: execution.revision,
        commandKey: execution.commandKey, eventHash: execution.eventHash, receipt: execution.result });
    }
    await correction(TRON_TRADE, "300", 1, "increase", true);
    await correction(TRON_TRADE, "250", 2, "decrease", false);
    await correction(BSC_TRADE, "1.00005", 1, "zero", true);

    async function settle(tradeId: string, assetId: AssetId, feeAmount: string, label: string) {
      const state = (await wallet.snapshot()).state;
      const trade = state.trades.get(tradeId)!;
      await next("markBuyerPaid", BUYER, `frozen-v2-${label}-paid`, tradeId);
      await next("verifyPayment", VERIFIER, `frozen-v2-${label}-verified`, { tradeId, evidence: {
        reference: `sim-evidence-frozen-v2-${label}`, amountMinor: trade.fiatTotalMinor.toString(), currency: "ILS", kind: "simulated-bank-credit" } });
      await next("authorizeRelease", SELLER, `frozen-v2-${label}-authorized`, tradeId);
      await next("reconcileAsset", VERIFIER, `frozen-v2-${label}-reconciled`, { assetId,
        observedRaw: expectedCustody((await wallet.snapshot()).state, assetId).toString(), complete: true });
      await next("setNativeFeeReadiness", OWNER, `frozen-v2-${label}-gas`, { assetId, ready: true });
      const queued = await next("queueRelease", DISPATCHER, `frozen-v2-${label}-queued`, tradeId);
      await next("beginDispatch", DISPATCHER, `frozen-v2-${label}-claimed`, queued.result.id);
      const asset = assetFor(assetId);
      await next("confirmPayout", VERIFIER, `frozen-v2-${label}-confirmed`, { payoutId: queued.result.id,
        providerReference: queued.result.providerReference, assetId, network: asset.network, token: asset.token,
        transactionId: `sim-tx-frozen-v2-${label}-settled`, eventIndex: 0, destination: queued.result.destination,
        amountRaw: queued.result.amountRaw.toString(), finalized: true, successful: true });
      const feeIntent = await next("createDepositIntent", SELLER, `frozen-v2-${label}-fee-intent`, {
        id: `frozen-v2-${label}-fees`, assetId, purpose: "commission" });
      await next("observeDeposit", VERIFIER, `frozen-v2-${label}-fee-credit`, { intentId: feeIntent.result.id,
        assetId, network: asset.network, token: asset.token, transactionId: `sim-tx-frozen-v2-${label}-fees`, eventIndex: 0,
        destination: feeIntent.result.destination, amountRaw: parseUnits(feeAmount, asset.decimals).toString(),
        blockHash: "sim-block-frozen-v2", finalized: true, successful: true });
    }
    await settle(TRON_TRADE, TRON, "5", "tron");
    await settle(BSC_TRADE, BSC, "0.020002", "bsc");
    const original = await wallet.snapshot();
    assert(isV2State(original.state));
    assertV2Invariants(original.state); assertLedgerInvariants(original.state);
    const serialized = await exportVersionedWalletBackup({ mode: "simulation-only", store, clock: () => now + STEP });
    const backup = JSON.parse(serialized) as { checksum: string; commands: Array<Record<string, unknown>> };
    const replayed = verifyVersionedHistory(backup.commands);
    assert.equal(walletDigest(replayed.state), walletDigest(original.state));
    const backupText = `${serialized}\n`;
    const stateText = `${JSON.stringify(walletJson(original.state), null, 2)}\n`;
    const files = {
      [NAMES[0]]: { bytes: Buffer.byteLength(backupText), sha256: hash(backupText) },
      [NAMES[1]]: { bytes: Buffer.byteLength(stateText), sha256: hash(stateText) },
    };
    const provenance = {
      purpose: "Frozen synthetic v2 compatibility evidence. Do not regenerate to make a changed engine pass.",
      sourceCommit: SOURCE_COMMIT, sourceTree: SOURCE_TREE, checkoutAtCapture, capturedAt: new Date().toISOString(),
      engineVersion: "alpha-wallet-simulation-v2", backupFormatVersion: 2,
      clock: { initialMs: START, commandStepMs: STEP, firstCommandAtMs: START + STEP, exportedAtMs: now + STEP },
      prefixCheckpoint, continuation: { revision: continuation.revision, commandKey: continuation.commandKey, eventHash: continuation.eventHash },
      checkpoint: checkpoint(original), backupChecksum: backup.checksum, sourceSha256, files,
      facts: { commands: backup.commands.length, enrollments: original.state.termsBindings.size,
        acceptanceReceipts: original.state.acceptanceReceipts.size, corrections: correctionFacts,
        tron: { fundedPrincipal: "600", listingPrincipal: "500", originalReservation: "200", finalDeliveredPrincipal: "250",
          separatelyFundedAndRecognizedFees: "5", listingAvailableRaw: balance(original.state, TRON, `listing:${TRON_LISTING}`).toString(),
          availableRaw: balance(original.state, TRON, `available:${SELLER.id}`).toString(),
          custodyRaw: expectedCustody(original.state, TRON).toString(), heldWithdrawalRaw: "25000000" },
        bsc: { fundedPrincipal: "10", finalDeliveredPrincipal: "1.00005", buyerFee: "0.010001", sellerFee: "0.010001",
          separatelyFundedAndRecognizedFees: "0.020002", listingAvailableRaw: balance(original.state, BSC, `listing:${BSC_LISTING}`).toString(),
          custodyRaw: expectedCustody(original.state, BSC).toString() },
        heldWithdrawal: { id: withdrawal.result.id, state: "submission_unknown", dispatchCount: 1,
          providerReference: withdrawal.result.providerReference },
      },
      limitations: [
        "Synthetic fixture actors, canonical terms, assets, fiat evidence and payout receipts; no platform login, chain/provider/signing calls or live funds.",
        "The existing v2 standalone ledger supports these two fixture enrollments; the separately bounded canonical coordinator is not activated.",
        "Buyer-authored reserveTrade, operator enrollment and buyer correction retain their recorded meanings; no seller-authored initial acceptance is represented.",
        "The two-proposal cap is retained: increase/decrease belong to one trade; zero-delta acceptance belongs to the second trade.",
        "The held withdrawal intentionally remains uncertain. Recovery cannot submit a replacement or authorize live operation.",
        "This is fixed compatibility evidence for captured v1/v2 semantics, not exhaustive coverage or implementation of a future engine/storage/recovery contract.",
      ],
    };
    await mkdir(OUTPUT, { recursive: true });
    for (const [name, content] of [[NAMES[0], backupText], [NAMES[1], stateText], [NAMES[2], `${JSON.stringify(provenance, null, 2)}\n`]]) {
      await writeFile(join(OUTPUT, name), content, { flag: "wx" });
    }
    console.log(JSON.stringify({ captured: NAMES, source: SOURCE_COMMIT, sourceFiles: SOURCE_PATHS.length,
      commands: original.revision, checkpoint: checkpoint(original), files, provenanceSha256: hash(readFileSync(join(OUTPUT, NAMES[2]))) }, null, 2));
  } finally {
    try { await store.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
