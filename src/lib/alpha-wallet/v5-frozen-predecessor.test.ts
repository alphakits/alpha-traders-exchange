// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V3_FIXTURE_TRADE, V3_RESTORE_AT, v3FixtureCheckpoint, v3FixtureHistory } from "../../../scripts/alpha-wallet/v3-durable-fixtures";
import { walletDigest, walletJson } from "./commands";
import { createFileWalletStore, type WalletStore } from "./durable-store";
import { balance } from "./ledger";
import { inspectV5WalletBackup, restoreV5WalletBackup } from "./v5-backup";
import { parseV5VersionedCommand, type V5VersionedCommand } from "./v5-commands";
import { createV5DurableWallet, verifyV5History } from "./v5-durable";
import { assertV5Invariants, baseV4StateForV5, isV5State, type V5State } from "./v5-engine";

const MODE = "simulation-only" as const, TIMEOUT = 120_000;
const variants = ["accepted", "claimed", "disputed", "cancelled", "inherited-paused"] as const;
type Variant = typeof variants[number];
type Row = Record<string, unknown>;
type Checkpoint = { revision: number; eventHash: string; stateHash: string; lastCommandAtMs: number };
type History = { format: string; formatVersion: number; mode: string; engineVersion: string;
  sourcePaused: boolean; checkpoint: Checkpoint; commands: Row[] };
type Capture = { checkpoint: Checkpoint; pausedCheckpoint: Checkpoint; backupChecksum: string;
  sourceV4Checkpoint: Checkpoint; claims: number; disputes: number; cancellations: number; retryProbeCount: number;
  trade: { status: string; disputed: boolean; principalRaw: string; reservedRaw: string }; originalPauseInherited: string | null };
type Retries = { mode: string; sourcePaused: boolean; checkpoint: Checkpoint;
  probes: Array<{ label: string; command: V5VersionedCommand; expected: { revision: number; eventHash: string; result: unknown } }> };
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const expectedFiles = {
  "accepted.history.json": "24540d799b3241f148ce30f54472a564449bd74602fee69235df340435f1af8c",
  "accepted.state.json": "1e51da42b0b4c84a6ad050c83ac10d89eef93a7cb5ed2556f93754a1c8ab2dbe",
  "accepted.backup.json": "8b04c245c5326979d18a4fb7c1b46093ae9e5706028a424adae769f236f194b5",
  "accepted.retries.json": "e0603957f79eb3d80b64acefb3864bf491c8ca7ebd6968b6b3a9374d34ef740e",
  "claimed.history.json": "3915279f81866e736d588b6a26e3a9cc090d58e66e014df8fb78ea6f4f567126",
  "claimed.state.json": "98fd3ed025fb89669aa0a656ce64293d8a7c7df1fd48fde396e9d4e7cd474120",
  "claimed.backup.json": "d1799c9bf97e8f25fa0df290d0ec9afdec7165d550036f6197ab760c4f26d91a",
  "claimed.retries.json": "139773937329ff6e7945e828d3f2d91020ba2264ad7eb8198b70ca2d6b84e925",
  "disputed.history.json": "d2cecdf2969d9af83a75f6bf71df071a219ad7bc4f98ed1fa59d6ccc862c3648",
  "disputed.state.json": "54196359cb0a35c79ec4ef1e6b2eec45d88180bde517ec9cc34a76518eb27378",
  "disputed.backup.json": "a4090d4fa92bcf45fbe8dfa29c72ee9dde151b6485afdbbf33221bb613388d5c",
  "disputed.retries.json": "e07c64cd528554069c2da933c6032a5f5ca7aa8ca1347b3e3494f4ddba5c4af2",
  "cancelled.history.json": "2aee453ca9f368e672132b74e98f3cdcffbdbed3dcdc37fac23ff6fe5ed80eb8",
  "cancelled.state.json": "01f98add35e6c69c7f39e7235ceae76171c8531bbf7592f861e8ee08f69ce4a9",
  "cancelled.backup.json": "80bf182b59b6667cad7f8d6ea25dc8488d139a0a83ae80fdb0378e09e69f8a33",
  "cancelled.retries.json": "7469493e2995a54be15edd81ba4cf826e8b624906b102cf32d7ce4250c6a7d52",
  "inherited-paused.history.json": "7b790e7bd6b8dbf7877bb0c22a40790206dd7d1b530323c9b3e8d41ff12327c9",
  "inherited-paused.state.json": "ac7e153b7a8cd0fdb9ef489ac0861ac9a9b558f9d506d9ef7f58c1baa4fd6a7b",
  "inherited-paused.backup.json": "92ba99ebf24429839966b79059df373b1c75c2195b44598852b23b4ee9715484",
  "inherited-paused.retries.json": "f14d52682d0b994b93d958c9dcd2998b8c8df5f80bc8cbfb31d10ba3ce8b2ddd",
} as const;
type FixtureName = keyof typeof expectedFiles;
function read(name: FixtureName) {
  const content = readFileSync(new URL(`./fixtures/v5/${name}`, import.meta.url), "utf8");
  expect(hash(content), name).toBe(expectedFiles[name]);
  return content;
}
const provenanceText = readFileSync(new URL("./fixtures/v5/provenance.json", import.meta.url), "utf8");
const provenance = JSON.parse(provenanceText) as { sourceCommit: string; sourceTree: string;
  verifiedImplementationCommit: string; verifiedImplementationTree: string; verifiedRunId: number;
  captureScriptSha256: string; sourceSha256: Record<string, string>; files: Record<FixtureName, { bytes: number; sha256: string }>;
  captures: Record<Variant, Capture> };
const history = (name: Variant): History => JSON.parse(read(`${name}.history.json`));
const backup = (name: Variant): History & { checksum: string } => JSON.parse(read(`${name}.backup.json`));
function sourceState(name: Variant): V5State {
  const current = verifyV5History(history(name).commands);
  if (!isV5State(current.state)) throw new Error("The pinned predecessor must finish in V5");
  return current.state;
}
function runtime() {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("TZ", "UTC");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
}
beforeEach(runtime);
afterEach(() => vi.unstubAllEnvs());

describe("independently frozen V5 predecessor evidence", () => {
  it("pins twenty independently captured artifacts and the full unchanged predecessor dependency closure", () => {
    expect(hash(provenanceText)).toBe("c935cfe894fde1c8cdaac88aaf6efc9d2937dc9dcd96f1d95f16bf7b3d4b93ae");
    expect(provenance).toMatchObject({ sourceCommit: "343cb147a0e6c64423dd00fed1cfe6d148fa86e8",
      sourceTree: "37e6244dc7a5af42304ffdc356e9ec95dfa6112d", verifiedImplementationCommit: "6c06159b12c6c23fd51cdd8eb4dba7745aff54cb",
      verifiedImplementationTree: "23c6ca3b1bc4d381766af79fe00940531c8239af", verifiedRunId: 42327193683 });
    expect(Object.keys(provenance.files).sort()).toEqual(Object.keys(expectedFiles).sort());
    for (const [name, expected] of Object.entries(expectedFiles)) {
      const content = read(name as FixtureName);
      expect(provenance.files[name as FixtureName]).toEqual({ bytes: Buffer.byteLength(content), sha256: expected });
    }
    expect(Object.keys(provenance.sourceSha256)).toHaveLength(197);
    for (const [path, expected] of Object.entries(provenance.sourceSha256)) {
      expect(hash(readFileSync(new URL(`../../../${path}`, import.meta.url))), path).toBe(expected);
    }
    expect(provenance.captureScriptSha256).toBe("2fcb918194a66e0675eae279f12c4bb2b8e4dff02d28ba7989187bfe74aa6b26");
    expect(hash(readFileSync(new URL("../../../scripts/alpha-wallet/capture-v5-history-fixture.ts", import.meta.url)))).toBe(provenance.captureScriptSha256);
  });

  it.each(variants)("replays every recorded %s prefix and its exact original state without adding financial authority", name => {
    const captured = history(name), frozen = provenance.captures[name];
    for (let index = 1; index <= captured.commands.length; index++) {
      const current = verifyV5History(captured.commands.slice(0, index)), row = captured.commands[index - 1]!;
      expect(v3FixtureCheckpoint(current)).toEqual({ revision: row.revision, eventHash: row.event_hash,
        stateHash: row.state_hash, lastCommandAtMs: Number(row.occurred_at_ms) });
    }
    const snapshot = verifyV5History(captured.commands), state = sourceState(name);
    expect(v3FixtureCheckpoint(snapshot)).toEqual(frozen.checkpoint);
    expect(walletJson(state)).toEqual(JSON.parse(read(`${name}.state.json`)));
    expect(state.paymentContinuation.checkpoint).toEqual(frozen.sourceV4Checkpoint);
    expect(state.paymentContinuation.sourceHaltReason).toBe(frozen.originalPauseInherited);
    const original = baseV4StateForV5(state), trade = state.trades.get(V3_FIXTURE_TRADE)!;
    expect(state.accounts).toEqual(original.accounts); expect(state.journal).toEqual(original.journal);
    expect(state.payouts).toEqual(original.payouts); expect(state.commissions).toEqual(original.commissions);
    expect(trade).toMatchObject({ status: frozen.trade.status, disputed: frozen.trade.disputed });
    expect(trade.amountRaw.toString()).toBe("200000000");
    expect(balance(state, trade.assetId, `trade:${trade.id}`).toString()).toBe(name === "cancelled" ? "0" : "200000000");
    expect(trade.evidence).toBeUndefined(); expect(trade.authorization).toBeUndefined(); expect(trade.payoutId).toBeUndefined();
    expect(state.initialPaymentClaimReceipts.size).toBe(frozen.claims);
    expect(state.initialDisputeFreezeReceipts.size).toBe(frozen.disputes);
    expect(state.initialCancellationReceipts.size).toBe(frozen.cancellations);
    expect(state.haltReason !== null).toBe(name === "inherited-paused");
    expect(state.payouts.get("withdrawal-v3-fixture-held-withdrawal")).toMatchObject({
      state: "submission_unknown", amountRaw: BigInt("25000000"), dispatchCount: 1,
      providerReference: "sim-payout-withdrawal-v3-fixture-held-withdrawal" });
    assertV5Invariants(state);
  });

  it.each(variants)("keeps the %s history distinct from its stopped isolated backup and immutable retry evidence", name => {
    const captured = history(name), stopped = backup(name), retries: Retries = JSON.parse(read(`${name}.retries.json`));
    const frozen = provenance.captures[name], inspected = inspectV5WalletBackup(read(`${name}.backup.json`), { expectedChecksum: frozen.backupChecksum });
    expect(inspected).toMatchObject({ formatVersion: 5, scope: "isolated-v5-ledger", sourcePaused: true,
      checkpoint: frozen.pausedCheckpoint, initialPaymentClaimCount: frozen.claims, initialDisputeFreezeCount: frozen.disputes,
      initialCancellationCount: frozen.cancellations });
    expect(stopped.commands.slice(0, captured.commands.length)).toEqual(captured.commands);
    expect(stopped.commands).toHaveLength(captured.commands.length + 1);
    expect(() => inspectV5WalletBackup(read(`${name}.history.json`))).toThrow();
    expect(retries).toMatchObject({ mode: MODE, sourcePaused: true, checkpoint: frozen.pausedCheckpoint });
    expect(retries.probes).toHaveLength(frozen.retryProbeCount);
    for (const probe of retries.probes) {
      const row = stopped.commands[probe.expected.revision - 1]!;
      expect(probe.expected).toMatchObject({ revision: row.revision, eventHash: row.event_hash, replayed: true, commandKey: row.command_key });
      if (probe.command.type === "beginDispatch") {
        expect(probe.expected.result).toMatchObject({ shouldDispatch: false, payout: { state: "submission_unknown", dispatchCount: 1 } });
        expect(row.result_json).toMatchObject({ shouldDispatch: true });
      } else expect(walletDigest(probe.expected.result)).toBe(row.result_hash);
    }
  });

  it.each(variants)("restores and reopens the frozen %s backup while original receipt retries remain non-dispatching", async name => {
    const directory = await mkdtemp(join(tmpdir(), `alpha-frozen-v5-${name}-`));
    const dataDir = join(directory, "target"), frozen = provenance.captures[name], stopped = backup(name);
    const retries: Retries = JSON.parse(read(`${name}.retries.json`));
    let store: WalletStore | undefined;
    try {
      store = await createFileWalletStore({ mode: MODE, dataDir });
      const result = await restoreV5WalletBackup({ mode: MODE, store, backup: read(`${name}.backup.json`),
        expectedChecksum: frozen.backupChecksum, acknowledgeFreshTarget: true, clock: () => V3_RESTORE_AT });
      expect(result).toMatchObject({ quarantined: true, backup: { checksum: frozen.backupChecksum },
        restored: { revision: frozen.pausedCheckpoint.revision + 1 } });
      await store.close(); store = undefined;
      store = await createFileWalletStore({ mode: MODE, dataDir });
      const wallet = createV5DurableWallet({ mode: MODE, store, clock: () => V3_RESTORE_AT + 100 });
      const restored = await wallet.snapshot();
      expect(v3FixtureCheckpoint(restored)).toEqual(result.restored);
      expect(restored.state.haltReason).not.toBeNull();
      const saved = await store.transaction(tx => v3FixtureHistory(tx));
      expect(saved.slice(0, stopped.commands.length)).toEqual(stopped.commands);
      expect(saved).toHaveLength(stopped.commands.length + 1);
      for (const probe of retries.probes) {
        expect(walletJson(await wallet.execute(parseV5VersionedCommand(probe.command)))).toEqual(probe.expected);
      }
      const dispatch = retries.probes.find(probe => probe.command.type === "beginDispatch")!;
      await expect(wallet.execute(parseV5VersionedCommand({ ...dispatch.command, requestId: "fresh-dispatch-must-remain-fenced" }))).rejects.toThrow();
      const recoveries = await wallet.recoverPayouts();
      expect(recoveries).toHaveLength(1);
      expect(recoveries[0]).toMatchObject({ action: "lookup_original_reference",
        payout: { state: "submission_unknown", dispatchCount: 1, amountRaw: BigInt("25000000") } });
      expect(await wallet.snapshot()).toEqual(restored);
      expect(await store.transaction(tx => v3FixtureHistory(tx))).toEqual(saved);
    } finally {
      try { await store?.close(); } finally { await rm(directory, { recursive: true, force: true }); }
    }
  }, TIMEOUT);

  it.each(["input_hash", "result_hash", "state_hash", "event_hash", "previous_event_hash"] as const)("refuses a changed frozen V5 claim %s", field => {
    const rows = history("claimed").commands;
    const claim = rows.find(row => row.command_type === "claimInitialPayment")!;
    claim[field] = "f".repeat(64);
    expect(() => verifyV5History(rows)).toThrow();
  });

  it.each(["evidence", "authorization", "payout"] as const)("refuses grafting %s authority onto an independently captured V5 claim", kind => {
    const state = sourceState("claimed"), trade = state.trades.get(V3_FIXTURE_TRADE)!;
    if (kind === "evidence") {
      trade.evidence = { reference: "synthetic-new-source", amountMinor: trade.fiatTotalMinor.toString(), currency: "ILS", kind: "simulated-bank-credit" };
      trade.status = "payment_verified";
    } else if (kind === "authorization") {
      trade.authorization = { sellerId: trade.sellerId, destination: trade.destination, amountRaw: trade.amountRaw, evidenceReference: "synthetic-new-source" };
      trade.status = "release_authorized";
    } else { trade.payoutId = "synthetic-new-payout"; trade.status = "payout_pending"; }
    expect(() => assertV5Invariants(state)).toThrow();
  });
});
