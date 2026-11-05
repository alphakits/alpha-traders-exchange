/**
 * One-time capture of already-verified, unchanged v3 semantics.
 *
 * NODE_ENV=test node --conditions=react-server --import tsx \
 *   scripts/alpha-wallet/capture-v3-history-fixture.ts --capture-frozen-v3-history
 *
 * Every source dependency and schema is compared with the pinned Git object
 * before a fresh temporary PGlite directory is opened. Existing evidence is
 * never overwritten. Tests consume the fixed files; they never run this script.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { walletJson } from "../../src/lib/alpha-wallet/commands";
import { createFileWalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { assertLedgerInvariants, balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { exportV3WalletBackup, inspectV3WalletBackup } from "../../src/lib/alpha-wallet/v3-backup";
import { v3Command, WALLET_V3_ENGINE_VERSION } from "../../src/lib/alpha-wallet/v3-commands";
import { verifyV3History } from "../../src/lib/alpha-wallet/v3-durable";
import { assertV3Invariants, isV3State } from "../../src/lib/alpha-wallet/v3-engine";
import { FIXTURE_TIME, OPERATOR, SELLER, TRON } from "./durable-fixtures";
import { buildV3AcceptanceFixture, V3_FIXTURE_LISTING, V3_FIXTURE_REQUEST, V3_FIXTURE_TRADE,
  v3FixtureCheckpoint, v3FixtureHistory } from "./v3-durable-fixtures";

const SOURCE_COMMIT = "2c3e6a0b809f9bb34f84dcc82243593ba079ee1f";
const SOURCE_TREE = "bcafe92cea246f709987643d6213b2347ed73e41";
const ROOT = resolve(import.meta.dirname, "../..");
const OUTPUT = join(ROOT, "src/lib/alpha-wallet/fixtures/v3");
// Transitive local imports of the original fixture and backup (including type
// contracts), plus schemas read from disk and dependency-resolution manifests.
const SOURCE_PATHS = [
  "package.json", "package-lock.json", "tsconfig.json",
  "docs/alpha-wallet/durable-schema.sql", "docs/alpha-wallet/durable-v2-migration.sql", "docs/alpha-wallet/durable-v3-migration.sql",
  "packages/contracts/src/cardless-withdrawal.ts", "packages/contracts/src/commission-amount.ts",
  "packages/contracts/src/display-amount.ts", "packages/contracts/src/index.ts", "packages/contracts/src/interface-access.ts",
  "packages/contracts/src/israeli-banks.ts", "packages/contracts/src/listing-trade-limits.ts",
  "packages/contracts/src/marketplace-fees.ts", "packages/contracts/src/mobile-v1.ts", "packages/contracts/src/native-web-bridge.ts",
  "packages/contracts/src/price-offer.ts", "packages/contracts/src/remembered-login.ts", "packages/contracts/src/seller-metrics.ts",
  "packages/contracts/src/trade-amount.ts", "packages/contracts/src/trade-chat.ts", "packages/contracts/src/trade-location.ts",
  "packages/contracts/src/trade-receipt.ts", "packages/contracts/src/trade-terms.ts", "packages/contracts/src/usd-ils-reference.ts",
  "packages/contracts/src/user-presence.ts", "packages/contracts/src/wallet-address.ts", "packages/contracts/src/whatsapp-contact.ts",
  "scripts/alpha-wallet/durable-fixtures.ts", "scripts/alpha-wallet/v3-durable-fixtures.ts",
  "src/lib/admin-announcement-attachment.ts", "src/lib/age-eligibility.ts", "src/lib/alpha-exchange-identity.ts",
  "src/lib/alpha-wallet/accepted-terms.ts", "src/lib/alpha-wallet/amounts.ts", "src/lib/alpha-wallet/backup.ts",
  "src/lib/alpha-wallet/commands.ts", "src/lib/alpha-wallet/durable-store.ts", "src/lib/alpha-wallet/durable.ts",
  "src/lib/alpha-wallet/initial-acceptance.ts", "src/lib/alpha-wallet/ledger.ts", "src/lib/alpha-wallet/runtime.ts",
  "src/lib/alpha-wallet/sandbox.ts", "src/lib/alpha-wallet/types.ts", "src/lib/alpha-wallet/v2-commands.ts",
  "src/lib/alpha-wallet/v2-engine.ts", "src/lib/alpha-wallet/v2-kernel.ts", "src/lib/alpha-wallet/v3-backup.ts",
  "src/lib/alpha-wallet/v3-commands.ts", "src/lib/alpha-wallet/v3-durable.ts", "src/lib/alpha-wallet/v3-engine.ts",
  "src/lib/alpha-wallet/v3-fixtures.ts", "src/lib/alpha-wallet/v3-projections.ts",
  "src/lib/alpha-wallet/versioned-durable.ts", "src/lib/alpha-wallet/versioned-projections.ts",
  "src/lib/fx-reference-policy.ts", "src/lib/marketplace-payment-methods.ts", "src/lib/phone-verification-exemptions.ts",
  "src/lib/requestable-listing.ts", "src/lib/roles.ts", "src/lib/runtime-safety.ts", "src/lib/seller-approval-verification.ts",
  "src/lib/seller-approval.ts", "src/lib/trade-amount-lock.ts", "src/lib/trade-amount.ts", "src/lib/trade-cancellation.ts",
  "src/lib/usdt-demand-policy.ts", "src/lib/verification-bypass.ts", "src/lib/wise-bank-transfer.ts",
  "src/lib/wise-payments-capability.ts", "src/lib/wise-store-policy.ts",
  "src/types/alpha-exchange.ts", "src/types/market.ts", "src/types/usdt-demand.ts", "src/types/wise.ts",
] as const;
const NAMES = ["initial-acceptance.history.json", "initial-acceptance.state.json", "initial-acceptance.backup.json", "provenance.json"] as const;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

async function main() {
  assert.deepEqual(process.argv.slice(2), ["--capture-frozen-v3-history"], "Explicit one-time fixture capture is required");
  assertSimulationRuntime("simulation-only");
  assert.equal(process.cwd(), ROOT, "Run from the repository root so the guarded schema paths are exact");
  for (const name of NAMES) assert(!existsSync(join(OUTPUT, name)), "Frozen evidence already exists; never regenerate expectations to make a changed engine pass");
  assert.equal(execFileSync("git", ["rev-parse", `${SOURCE_COMMIT}^{tree}`], { cwd: ROOT, encoding: "utf8" }).trim(), SOURCE_TREE);
  const sourceSha256: Record<string, string> = {};
  for (const path of SOURCE_PATHS) {
    const verified = execFileSync("git", ["show", `${SOURCE_COMMIT}:${path}`], { cwd: ROOT });
    assert(verified.equals(readFileSync(join(ROOT, path))), `Refusing capture from changed verified source: ${path}`);
    sourceSha256[path] = hash(verified);
  }
  const checkoutAtCapture = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const directory = await mkdtemp(join(tmpdir(), "alpha-wallet-frozen-v3-capture-"));
  const store = await createFileWalletStore({ mode: "simulation-only", dataDir: join(directory, "source") });
  try {
    const fixture = await buildV3AcceptanceFixture(store, { accept: true, pause: false, unknownWithdrawal: true });
    const original = fixture.snapshot;
    assert(isV3State(original.state));
    assert.equal(original.state.haltReason, null);
    assert.equal(original.revision, 14);
    assertV3Invariants(original.state); assertLedgerInvariants(original.state);
    const commands = await store.transaction(tx => v3FixtureHistory(tx));
    const unpausedCheckpoint = v3FixtureCheckpoint(original);
    assert.deepEqual(v3FixtureCheckpoint(verifyV3History(commands)), unpausedCheckpoint);
    const historyText = `${JSON.stringify({
      format: "alpha-wallet-frozen-command-history", formatVersion: 1, mode: "simulation-only",
      engineVersion: WALLET_V3_ENGINE_VERSION, sourcePaused: false, checkpoint: unpausedCheckpoint, commands,
    }, null, 2)}\n`;
    const stateText = `${JSON.stringify(walletJson(original.state), null, 2)}\n`;
    const held = original.state.payouts.get("withdrawal-v3-fixture-held-withdrawal");
    assert(held && held.state === "submission_unknown" && held.dispatchCount === 1);
    assert.equal(balance(original.state, TRON, `trade:${V3_FIXTURE_TRADE}`), BigInt("200000000"));
    assert.equal(balance(original.state, TRON, `listing:${V3_FIXTURE_LISTING}`), BigInt("300000000"));

    // Keep the unpaused original history separately. The existing backup format
    // requires a source pause, and restoring it must still append quarantine.
    const pause = await fixture.wallet.execute(v3Command("pause", OPERATOR, "frozen-v3-source-pause", null));
    const paused = await fixture.wallet.snapshot();
    assert.equal(paused.revision, original.revision + 1);
    const serialized = await exportV3WalletBackup({ mode: "simulation-only", store, clock: () => fixture.now() + 1 });
    const inspected = inspectV3WalletBackup(serialized);
    const backup = JSON.parse(serialized) as { commands: Array<Record<string, unknown>> };
    assert.deepEqual(backup.commands.slice(0, commands.length), commands);
    const backupText = `${serialized}\n`;
    const contents = [[NAMES[0], historyText], [NAMES[1], stateText], [NAMES[2], backupText]] as const;
    const files = Object.fromEntries(contents.map(([name, content]) => [name, { bytes: Buffer.byteLength(content), sha256: hash(content) }]));
    const provenance = {
      purpose: "Frozen synthetic v3 compatibility evidence. Do not regenerate to make a changed engine pass.",
      sourceCommit: SOURCE_COMMIT, sourceTree: SOURCE_TREE, checkoutAtCapture, capturedAt: new Date().toISOString(),
      engineVersion: WALLET_V3_ENGINE_VERSION, backupFormatVersion: 3,
      captureScriptSha256: hash(readFileSync(new URL(import.meta.url))),
      clock: { initialMs: FIXTURE_TIME, commandStepMs: 1, firstCommandAtMs: FIXTURE_TIME + 1,
        exportedAtMs: inspected.exportedAtMs },
      v2PrefixCheckpoint: v3FixtureCheckpoint(fixture.prefix),
      beforeAcceptanceCheckpoint: v3FixtureCheckpoint(fixture.before),
      unpausedCheckpoint, pausedCheckpoint: v3FixtureCheckpoint(paused),
      backupChecksum: inspected.checksum,
      pause: { revision: pause.revision, commandKey: pause.commandKey, eventHash: pause.eventHash },
      sourceSha256, files,
      facts: {
        unpausedCommands: commands.length, pausedCommands: backup.commands.length,
        initialAcceptances: original.state.initialAcceptanceReceipts.size,
        listingId: V3_FIXTURE_LISTING, walletTradeId: V3_FIXTURE_TRADE, platformRequestId: V3_FIXTURE_REQUEST,
        acceptance: { commandKey: fixture.execution!.commandKey, revision: fixture.execution!.revision,
          eventHash: fixture.execution!.eventHash, receipt: fixture.execution!.result },
        tron: { fundedPrincipal: "600", listingPrincipal: "500", reservedPrincipal: "200",
          listingPrice: "3.20", retainedRequestPrice: "3.10", buyerFee: "2", sellerFee: "2",
          listingAvailableRaw: balance(original.state, TRON, `listing:${V3_FIXTURE_LISTING}`).toString(),
          availableRaw: balance(original.state, TRON, `available:${SELLER.id}`).toString(),
          custodyRaw: expectedCustody(original.state, TRON).toString(), heldWithdrawalRaw: held.amountRaw.toString() },
        heldWithdrawal: { id: held.id, state: held.state, dispatchCount: held.dispatchCount, providerReference: held.providerReference },
      },
      limitations: [
        "Synthetic actors, canonical request evidence, assets and payout references; no login, chain/provider connection, keys, signing or live funds.",
        "Wallet-only history; canonical marketplace and coordination databases are not represented by this fixture or its backup.",
        "The accepted request reserves the full principal at its retained request price; fees remain separate and unpaid.",
        "The original unpaused prefix is compatibility evidence, not a backup restore or an authorization to resume a quarantined database.",
        "The supported backup adds a source pause; restore still requires the original v3 quarantine contract.",
        "The held withdrawal remains submission_unknown with one dispatch. No replacement or renewed dispatch is authorized.",
        "These fixed v1/v2/v3 bytes do not implement or verify a future v4 command, migration, signer or launch contract.",
      ],
    };
    await mkdir(OUTPUT, { recursive: true });
    for (const [name, content] of [...contents, [NAMES[3], `${JSON.stringify(provenance, null, 2)}\n`]]) {
      await writeFile(join(OUTPUT, name), content, { flag: "wx" });
    }
    console.log(JSON.stringify({ captured: NAMES, source: SOURCE_COMMIT, sourceFiles: SOURCE_PATHS.length,
      unpausedCheckpoint, pausedCheckpoint: provenance.pausedCheckpoint, files,
      backupChecksum: inspected.checksum, provenanceSha256: hash(readFileSync(join(OUTPUT, NAMES[3]))) }, null, 2));
  } finally {
    try { await store.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
