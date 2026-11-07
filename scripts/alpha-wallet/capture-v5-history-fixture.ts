/**
 * One-time capture of the pinned, unchanged V5 predecessor implementation.
 * TZ=UTC NODE_ENV=test node --conditions=react-server --import tsx scripts/alpha-wallet/capture-v5-history-fixture.ts --capture-frozen-v5-history
 * No successor implementation participates. Existing evidence is never replaced;
 * tests consume the retained bytes and never invoke this capture script.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { walletDigest, walletJson } from "../../src/lib/alpha-wallet/commands";
import { createFileWalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { assertLedgerInvariants, balance } from "../../src/lib/alpha-wallet/ledger";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { exportV5WalletBackup, inspectV5WalletBackup } from "../../src/lib/alpha-wallet/v5-backup";
import { parseV5VersionedCommand, v5Command, WALLET_V5_ENGINE_VERSION, type V5VersionedCommand } from "../../src/lib/alpha-wallet/v5-commands";
import { verifyV5History } from "../../src/lib/alpha-wallet/v5-durable";
import { assertV5Invariants, baseV4StateForV5, isV5State } from "../../src/lib/alpha-wallet/v5-engine";
import { OPERATOR } from "./durable-fixtures";
import { V3_FIXTURE_TRADE, v3FixtureCheckpoint, v3FixtureHistory } from "./v3-durable-fixtures";
import { buildV5PaymentFixture } from "./v5-durable-fixtures";

const SOURCE_COMMIT = "343cb147a0e6c64423dd00fed1cfe6d148fa86e8";
const SOURCE_TREE = "37e6244dc7a5af42304ffdc356e9ec95dfa6112d";
const VERIFIED_IMPLEMENTATION = "6c06159b12c6c23fd51cdd8eb4dba7745aff54cb";
const VERIFIED_TREE = "23c6ca3b1bc4d381766af79fe00940531c8239af";
const ROOT = resolve(import.meta.dirname, "../..");
const OUTPUT = join(ROOT, "src/lib/alpha-wallet/fixtures/v5");
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const variants = [
  { name: "accepted", options: { claim: false } },
  { name: "claimed", options: { claim: true } },
  { name: "disputed", options: { claim: true, dispute: true } },
  { name: "cancelled", options: { claim: false, cancelledSource: true } },
  { name: "inherited-paused", options: { claim: false, sourcePaused: true } },
] as const;
const extensions = ["history.json", "state.json", "backup.json", "retries.json"] as const;
const names = [...variants.flatMap(({ name }) => extensions.map(extension => `${name}.${extension}`)), "provenance.json"];
const git = (args: string[]) => execFileSync("git", args, { cwd: ROOT });
const tracked = new Set(git(["ls-tree", "-r", "--name-only", SOURCE_COMMIT]).toString("utf8").trim().split("\n"));
const originalBytes = new Map<string, Buffer>();
function original(path: string) {
  let bytes = originalBytes.get(path);
  if (!bytes) { bytes = git(["show", `${SOURCE_COMMIT}:${path}`]); originalBytes.set(path, bytes); }
  return bytes;
}
function dependencies() {
  const previous = JSON.parse(original("src/lib/alpha-wallet/fixtures/v4/provenance.json").toString("utf8")) as { sourceSha256: Record<string, string> };
  const recorded = JSON.parse(original("docs/alpha-wallet/development-verification-results-2026-11-07.json").toString("utf8")) as {
    checks: { frozen_contract_retention: { sourceSha256: Record<string, string> } };
  };
  const paths = new Set([...Object.keys(previous.sourceSha256), ...Object.keys(recorded.checks.frozen_contract_retention.sourceSha256),
    ".nvmrc", "scripts/patch-expo-uri-decoder.mjs", "scripts/patch-dependency-security.mjs"]);
  for (const path of tracked) {
    if ((path.startsWith("docs/alpha-wallet/") && path.endsWith(".sql"))
      || (path.startsWith("src/lib/alpha-wallet/fixtures/") && path.endsWith(".json"))) paths.add(path);
  }
  const pending = ["scripts/alpha-wallet/v5-durable-fixtures.ts", "scripts/alpha-wallet/v5-engine-fixtures.ts",
    "src/lib/alpha-wallet/v5-backup.ts", "scripts/alpha-wallet/payment-marketplace-fixtures.ts",
    "src/lib/alpha-wallet/payment-marketplace-backup.ts", "src/lib/alpha-wallet/trusted-payment-evidence.ts",
    "src/lib/alpha-wallet/trusted-payment-fixture.ts", "src/lib/alpha-wallet/trusted-payment-journal-model.ts",
    "src/lib/alpha-wallet/trusted-payment-journal-store.ts", "src/lib/alpha-wallet/deposit-range-coverage.ts",
    "src/lib/alpha-wallet/deposit-range-native.ts"];
  const visited = new Set<string>();
  while (pending.length) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path); paths.add(path);
    if (!/\.tsx?$/.test(path)) continue;
    const source = original(path).toString("utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)) {
      const specifier = match[1]!;
      const base = specifier.startsWith(".") ? resolve(ROOT, dirname(path), specifier)
        : specifier.startsWith("@/") ? resolve(ROOT, "src", specifier.slice(2))
          : specifier === "@alpha-traders/contracts" ? resolve(ROOT, "packages/contracts/src/index") : null;
      if (!base) continue;
      const dependency = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]
        .map(candidate => relative(ROOT, candidate))
        .find(candidate => tracked.has(candidate) && /\.(?:tsx?|json)$/.test(candidate));
      assert(dependency, `Cannot resolve pinned source dependency ${specifier} from ${path}`);
      pending.push(dependency);
    }
    for (const match of source.matchAll(/["'](docs\/alpha-wallet\/[^"']+\.sql)["']/g)) paths.add(match[1]!);
    // The canonical/recovery modules also load bare names through their fixed
    // sql(name) helper. Those SQL contracts must not disappear from provenance.
    for (const match of source.matchAll(/\bsql\(["']([^/"']+\.sql)["']\)/g)) paths.add(`docs/alpha-wallet/${match[1]!}`);
  }
  return [...paths].sort();
}
function checkPinnedSources(paths: string[]) {
  const sourceSha256: Record<string, string> = {};
  for (const path of paths) {
    const bytes = original(path);
    assert(bytes.equals(readFileSync(join(ROOT, path))), `Pinned predecessor source changed before capture: ${path}`);
    sourceSha256[path] = hash(bytes);
  }
  return sourceSha256;
}

async function main() {
  assert.deepEqual(process.argv.slice(2), ["--capture-frozen-v5-history"]);
  assertSimulationRuntime("simulation-only");
  assert.equal(process.cwd(), ROOT);
  assert.equal(process.env.TZ, "UTC", "Capture uses explicit UTC, independently of the user's display timezone");
  assert.equal(process.version, `v${original(".nvmrc").toString("utf8").trim()}`);
  assert.equal(git(["rev-parse", `${SOURCE_COMMIT}^{tree}`]).toString("utf8").trim(), SOURCE_TREE);
  for (const name of names) assert(!existsSync(join(OUTPUT, name)), "Frozen evidence already exists; never recapture it for a successor");
  const paths = dependencies(), sourceSha256 = checkPinnedSources(paths);
  const captureScriptSha256 = hash(readFileSync(new URL(import.meta.url)));
  const contents = new Map<string, string>(), captures: Record<string, unknown> = {};
  for (const { name, options } of variants) {
    const directory = await mkdtemp(join(tmpdir(), `alpha-wallet-v5-${name}-capture-`));
    const store = await createFileWalletStore({ mode: "simulation-only", dataDir: join(directory, "source") });
    try {
      const fixture = await buildV5PaymentFixture(store, { ...options, pause: false, unknownWithdrawal: true });
      const snapshot = fixture.snapshot;
      assert(isV5State(snapshot.state)); assertV5Invariants(snapshot.state); assertLedgerInvariants(snapshot.state);
      assert.deepEqual(baseV4StateForV5(snapshot.state), fixture.original.snapshot.state);
      assert.deepEqual(snapshot.state.accounts, fixture.original.snapshot.state.accounts);
      assert.deepEqual(snapshot.state.journal, fixture.original.snapshot.state.journal);
      const trade = snapshot.state.trades.get(V3_FIXTURE_TRADE)!;
      assert.equal(trade.status, name === "cancelled" ? "cancelled" : name === "claimed" || name === "disputed" ? "payment_reported" : "reserved");
      assert.equal(trade.disputed, name === "disputed");
      assert.equal(snapshot.state.haltReason !== null, name === "inherited-paused");
      const held = snapshot.state.payouts.get("withdrawal-v3-fixture-held-withdrawal");
      assert(held && held.state === "submission_unknown" && held.dispatchCount === 1);
      const commands = await store.transaction(tx => v3FixtureHistory(tx));
      const checkpoint = v3FixtureCheckpoint(snapshot);
      assert.deepEqual(v3FixtureCheckpoint(verifyV5History(commands)), checkpoint);
      const history = { format: "alpha-wallet-frozen-command-history", formatVersion: 1, mode: "simulation-only",
        engineVersion: WALLET_V5_ENGINE_VERSION, sourcePaused: snapshot.state.haltReason !== null, checkpoint, commands };
      contents.set(`${name}.history.json`, `${JSON.stringify(history, null, 2)}\n`);
      contents.set(`${name}.state.json`, `${JSON.stringify(walletJson(snapshot.state), null, 2)}\n`);
      const pause = await fixture.wallet.execute(v5Command("pause", OPERATOR, `frozen-v5-${name}-pause`, null));
      const serialized = await exportV5WalletBackup({ mode: "simulation-only", store, clock: () => fixture.now() + 1 });
      const inspected = inspectV5WalletBackup(serialized), backup = JSON.parse(serialized) as { commands: Array<Record<string, unknown>> };
      assert.deepEqual(backup.commands.slice(0, commands.length), commands);
      contents.set(`${name}.backup.json`, `${serialized}\n`);

      const retries: Array<{ label: string; command: V5VersionedCommand; expected: unknown }> = [];
      const selected = commands.filter(row => ["acceptInitialSellerRequest", "cancelInitialTrade", "claimInitialPayment", "freezeInitialDispute", "beginDispatch"].includes(row.command_type as string));
      for (const row of selected) {
        const command = parseV5VersionedCommand(row.command_json);
        const expected = await fixture.wallet.execute(command);
        assert.equal(expected.replayed, true); assert.equal(expected.revision, row.revision); assert.equal(expected.eventHash, row.event_hash);
        if (command.type === "beginDispatch") {
          assert.equal((expected.result as { shouldDispatch: boolean }).shouldDispatch, false);
          assert.equal((row.result_json as { shouldDispatch: boolean }).shouldDispatch, true);
        } else assert.equal(walletDigest(expected.result), row.result_hash);
        retries.push({ label: `${command.type}:exact`, command, expected: walletJson(expected) });
        if (command.type !== "beginDispatch") {
          const alternate = parseV5VersionedCommand({ ...command, requestId: `frozen-v5-${name}-${retries.length}-retry` });
          const repeated = await fixture.wallet.execute(alternate);
          assert.deepEqual(repeated, expected);
          retries.push({ label: `${command.type}:business-identity`, command: alternate, expected: walletJson(repeated) });
        }
      }
      assert.deepEqual(await store.transaction(tx => v3FixtureHistory(tx)), backup.commands);
      assert.deepEqual(v3FixtureCheckpoint(await fixture.wallet.snapshot()), inspected.checkpoint);
      contents.set(`${name}.retries.json`, `${JSON.stringify({ mode: "simulation-only", sourcePaused: true,
        checkpoint: inspected.checkpoint, probes: retries }, null, 2)}\n`);
      captures[name] = { checkpoint, pausedCheckpoint: inspected.checkpoint, backupChecksum: inspected.checksum,
        commandCount: commands.length, sourcePaused: snapshot.state.haltReason !== null,
        sourceV4Checkpoint: v3FixtureCheckpoint(fixture.original.snapshot), originalPauseInherited: snapshot.state.paymentContinuation.sourceHaltReason,
        trade: { id: trade.id, status: trade.status, disputed: trade.disputed, principalRaw: trade.amountRaw.toString(),
          reservedRaw: balance(snapshot.state, trade.assetId, `trade:${trade.id}`).toString() },
        claims: snapshot.state.initialPaymentClaimReceipts.size, disputes: snapshot.state.initialDisputeFreezeReceipts.size,
        cancellations: snapshot.state.initialCancellationReceipts.size, pause, retryProbeCount: retries.length,
        heldWithdrawal: { id: held.id, state: held.state, dispatchCount: held.dispatchCount,
          amountRaw: held.amountRaw.toString(), providerReference: held.providerReference } };
    } finally {
      try { await store.close(); } finally { await rm(directory, { recursive: true, force: true }); }
    }
  }
  assert.deepEqual(checkPinnedSources(paths), sourceSha256, "Predecessor source changed while capturing evidence");
  assert.equal(hash(readFileSync(new URL(import.meta.url))), captureScriptSha256);
  const files = Object.fromEntries([...contents].map(([name, content]) => [name, { bytes: Buffer.byteLength(content), sha256: hash(content) }]));
  const provenance = { purpose: "Independent frozen V5 accepted, claimed, disputed, cancelled and inherited-paused predecessor evidence; never regenerate for a successor.",
    sourceCommit: SOURCE_COMMIT, sourceTree: SOURCE_TREE,
    verifiedImplementationCommit: VERIFIED_IMPLEMENTATION, verifiedImplementationTree: VERIFIED_TREE, verifiedRunId: 42327193683,
    checkoutAtCapture: git(["rev-parse", "HEAD"]).toString("utf8").trim(), capturedAt: new Date().toISOString(),
    engineVersion: WALLET_V5_ENGINE_VERSION, backupFormatVersion: 5, backupScope: "isolated-v5-ledger",
    runtime: { node: process.version, platform: process.platform, architecture: process.arch, timezone: process.env.TZ,
      pglite: (JSON.parse(readFileSync(join(ROOT, "node_modules/@electric-sql/pglite/package.json"), "utf8")) as { version: string }).version },
    captureScriptSha256, sourceSha256, files, captures,
    limitations: ["Synthetic isolated wallet fixtures only; no canonical account authority, bank source, keys, signer or live funds.",
      "The frozen source list additionally retains original combined V5 recovery dependencies and helper-loaded SQL; these isolated captures do not establish new canonical recovery authority.",
      "Every old V1–V5 command/result/hash and original receipt meaning is retained. New receipt interpretation requires a separate explicit profile.",
      "Unpaused histories are compatibility evidence and never active restoration or resume authority. Exported backups are stopped and require fresh-target quarantine.",
      "All histories retain a submission_unknown withdrawal with one original dispatch. Retry probes explicitly suppress a second dispatch.",
      "These expectations were captured from the pinned predecessor, without invoking any successor, and do not themselves verify a later implementation."] };
  contents.set("provenance.json", `${JSON.stringify(provenance, null, 2)}\n`);
  await mkdir(OUTPUT, { recursive: true });
  for (const [name, content] of contents) await writeFile(join(OUTPUT, name), content, { flag: "wx" });
  console.log(JSON.stringify({ source: SOURCE_COMMIT, sourceTree: SOURCE_TREE, sourceFiles: paths.length,
    provenanceSha256: hash(contents.get("provenance.json")!), captures, files }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
