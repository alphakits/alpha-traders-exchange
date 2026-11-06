/**
 * One-time independent capture of the pinned, unchanged V4 implementation.
 * NODE_ENV=test node --conditions=react-server --import tsx scripts/alpha-wallet/capture-v4-history-fixture.ts --capture-frozen-v4-history
 * This script refuses changed source or existing evidence. Tests never recapture it.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { walletJson } from "../../src/lib/alpha-wallet/commands";
import { createFileWalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { assertLedgerInvariants } from "../../src/lib/alpha-wallet/ledger";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { exportV4WalletBackup, inspectV4WalletBackup } from "../../src/lib/alpha-wallet/v4-backup";
import { v4Command, WALLET_V4_ENGINE_VERSION } from "../../src/lib/alpha-wallet/v4-commands";
import { verifyV4History } from "../../src/lib/alpha-wallet/v4-durable";
import { assertV4Invariants, isV4State } from "../../src/lib/alpha-wallet/v4-engine";
import { OPERATOR } from "./durable-fixtures";
import { V3_FIXTURE_TRADE, v3FixtureCheckpoint, v3FixtureHistory } from "./v3-durable-fixtures";
import { buildV4CancellationFixture } from "./v4-durable-fixtures";

const SOURCE_COMMIT = "26ac313212071c3ca600ad19dfb72cac234c0ef0";
const SOURCE_TREE = "3254c852ba07dac2af9989bbba763b07f4b14727";
const ROOT = resolve(import.meta.dirname, "../..");
const OUTPUT = join(ROOT, "src/lib/alpha-wallet/fixtures/v4");
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const variants = ["accepted", "cancelled"] as const;
const names = [...variants.flatMap(name => [`${name}.history.json`, `${name}.state.json`, `${name}.backup.json`]), "provenance.json"];

function dependencies() {
  const previous = JSON.parse(readFileSync(join(ROOT, "src/lib/alpha-wallet/fixtures/v3/provenance.json"), "utf8")) as { sourceSha256: Record<string, string> };
  const paths = new Set(Object.keys(previous.sourceSha256));
  const pending = ["scripts/alpha-wallet/v4-durable-fixtures.ts", "src/lib/alpha-wallet/v4-backup.ts"];
  const visited = new Set<string>();
  while (pending.length) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path); paths.add(path);
    if (!/\.tsx?$/.test(path)) continue;
    const source = readFileSync(join(ROOT, path), "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)) {
      const specifier = match[1]!;
      const base = specifier.startsWith(".") ? resolve(ROOT, dirname(path), specifier)
        : specifier.startsWith("@/") ? resolve(ROOT, "src", specifier.slice(2))
          : specifier === "@alpha-traders/contracts" ? resolve(ROOT, "packages/contracts/src/index") : null;
      if (!base) continue;
      const dependency = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find(candidate => existsSync(candidate) && /\.(?:tsx?|json)$/.test(candidate));
      assert(dependency, `Cannot resolve source dependency ${specifier} from ${path}`);
      pending.push(relative(ROOT, dependency));
    }
    for (const match of source.matchAll(/["'](docs\/alpha-wallet\/[^"']+\.sql)["']/g)) paths.add(match[1]!);
  }
  return [...paths].sort();
}

async function main() {
  assert.deepEqual(process.argv.slice(2), ["--capture-frozen-v4-history"]);
  assertSimulationRuntime("simulation-only");
  assert.equal(process.cwd(), ROOT);
  for (const name of names) assert(!existsSync(join(OUTPUT, name)), "Frozen evidence already exists; never regenerate it for a successor");
  assert.equal(execFileSync("git", ["rev-parse", `${SOURCE_COMMIT}^{tree}`], { cwd: ROOT, encoding: "utf8" }).trim(), SOURCE_TREE);
  const sourceSha256: Record<string, string> = {};
  for (const path of dependencies()) {
    const source = execFileSync("git", ["show", `${SOURCE_COMMIT}:${path}`], { cwd: ROOT });
    assert(source.equals(readFileSync(join(ROOT, path))), `Pinned source changed before capture: ${path}`);
    sourceSha256[path] = hash(source);
  }
  const contents = new Map<string, string>();
  const captures: Record<string, unknown> = {};
  for (const name of variants) {
    const directory = await mkdtemp(join(tmpdir(), `alpha-wallet-v4-${name}-capture-`));
    const store = await createFileWalletStore({ mode: "simulation-only", dataDir: join(directory, "source") });
    try {
      const fixture = await buildV4CancellationFixture(store, { cancel: name === "cancelled", pause: false, unknownWithdrawal: true });
      const original = fixture.snapshot;
      assert(isV4State(original.state)); assert.equal(original.state.haltReason, null);
      assertV4Invariants(original.state); assertLedgerInvariants(original.state);
      assert.equal(original.state.trades.get(V3_FIXTURE_TRADE)!.status, name === "cancelled" ? "cancelled" : "reserved");
      const held = original.state.payouts.get("withdrawal-v3-fixture-held-withdrawal");
      assert(held && held.state === "submission_unknown" && held.dispatchCount === 1);
      const commands = await store.transaction(tx => v3FixtureHistory(tx));
      const checkpoint = v3FixtureCheckpoint(original);
      assert.deepEqual(v3FixtureCheckpoint(verifyV4History(commands)), checkpoint);
      contents.set(`${name}.history.json`, `${JSON.stringify({ format: "alpha-wallet-frozen-command-history", formatVersion: 1,
        mode: "simulation-only", engineVersion: WALLET_V4_ENGINE_VERSION, sourcePaused: false, checkpoint, commands }, null, 2)}\n`);
      contents.set(`${name}.state.json`, `${JSON.stringify(walletJson(original.state), null, 2)}\n`);
      const pause = await fixture.wallet.execute(v4Command("pause", OPERATOR, `frozen-v4-${name}-pause`, null));
      const serialized = await exportV4WalletBackup({ mode: "simulation-only", store, clock: () => fixture.now() + 1 });
      const inspected = inspectV4WalletBackup(serialized);
      assert.deepEqual(JSON.parse(serialized).commands.slice(0, commands.length), commands);
      contents.set(`${name}.backup.json`, `${serialized}\n`);
      captures[name] = { checkpoint, pausedCheckpoint: inspected.checkpoint, backupChecksum: inspected.checksum,
        commandCount: commands.length, pause, heldWithdrawal: { id: held.id, state: held.state, dispatchCount: held.dispatchCount,
          amountRaw: held.amountRaw.toString(), providerReference: held.providerReference } };
    } finally {
      try { await store.close(); } finally { await rm(directory, { recursive: true, force: true }); }
    }
  }
  const files = Object.fromEntries([...contents].map(([name, content]) => [name, { bytes: Buffer.byteLength(content), sha256: hash(content) }]));
  const provenance = { purpose: "Independent frozen V4 accepted and cancelled compatibility evidence; never regenerate for V5.",
    sourceCommit: SOURCE_COMMIT, sourceTree: SOURCE_TREE,
    checkoutAtCapture: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    capturedAt: new Date().toISOString(), engineVersion: WALLET_V4_ENGINE_VERSION, backupFormatVersion: 4,
    captureScriptSha256: hash(readFileSync(new URL(import.meta.url))), sourceSha256, files, captures,
    limitations: ["Synthetic wallet-only data; no canonical authority, keys, signing, live funds or provider connection.",
      "Original paused backups retain V4 quarantine requirements. Unpaused history is compatibility evidence, never resume authority.",
      "Both histories preserve an original submission_unknown withdrawal with one dispatch; no replacement dispatch is authorized.",
      "These predecessor expectations were captured before V5 implementation and do not themselves verify V5."] };
  await mkdir(OUTPUT, { recursive: true });
  contents.set("provenance.json", `${JSON.stringify(provenance, null, 2)}\n`);
  for (const [name, content] of contents) await writeFile(join(OUTPUT, name), content, { flag: "wx" });
  console.log(JSON.stringify({ source: SOURCE_COMMIT, sourceFiles: Object.keys(sourceSha256).length, captures, files }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
