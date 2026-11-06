// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { V3_FIXTURE_TRADE, V3_RESTORE_AT, v3FixtureHistory } from "../../../scripts/alpha-wallet/v3-durable-fixtures";
import { buildV5PaymentFixture } from "../../../scripts/alpha-wallet/v5-durable-fixtures";
import { MAX_WALLET_BACKUP_BYTES } from "./backup";
import { walletDigest } from "./commands";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletStore } from "./durable-store";
import { inspectV4WalletBackup } from "./v4-backup";
import { exportV5WalletBackup, inspectV5WalletBackup, restoreV5WalletBackup } from "./v5-backup";
import { createV5DurableWallet } from "./v5-durable";
import { baseV4StateForV5, isV5State } from "./v5-engine";

const TIMEOUT = 120_000, MODE = "simulation-only" as const;
type BackupCommand = Record<string, unknown> & {
  command_type: string;
  command_json: { actor: Record<string, unknown>; input: { claim: { proof: Record<string, unknown> }; priorClaim: Record<string, unknown> } };
  result_json: Record<string, unknown>;
};
type BackupDocument = Record<string, unknown> & {
  exportedAtMs: number; commands: BackupCommand[];
  paymentContinuation: { checkpoint: Record<string, unknown>; sourceHaltReason?: unknown; commandRevision: number };
};
let source: WalletStore, sourceDir: string, directory: string, serialized: string;
let fixture: Awaited<ReturnType<typeof buildV5PaymentFixture>>;
const stores: WalletStore[] = [];
function runtime() {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
}
beforeAll(async () => {
  runtime(); sourceDir = await mkdtemp(join(tmpdir(), "v5-backup-source-"));
  source = await createFileWalletStore({ mode: MODE, dataDir: join(sourceDir, "wallet") });
  fixture = await buildV5PaymentFixture(source, { dispute: true, pause: true, unknownWithdrawal: true });
  serialized = await exportV5WalletBackup({ mode: MODE, store: source, clock: () => V3_RESTORE_AT - 1 });
}, TIMEOUT);
beforeEach(async () => { runtime(); directory = await mkdtemp(join(tmpdir(), "v5-backup-target-")); });
afterEach(async () => {
  try { await Promise.allSettled(stores.splice(0).map(store => store.close())); }
  finally { await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
}, TIMEOUT);
afterAll(async () => {
  runtime(); try { await source.close(); } finally { await rm(sourceDir, { recursive: true, force: true }); vi.unstubAllEnvs(); }
}, TIMEOUT);
async function target(name = "target") { const store = await createFileWalletStore({ mode: MODE, dataDir: join(directory, name) }); stores.push(store); return store; }
const restore = (store: WalletStore, backup = serialized) => restoreV5WalletBackup({ mode: MODE, store, backup, acknowledgeFreshTarget: true, clock: () => V3_RESTORE_AT });
const document = (): BackupDocument => JSON.parse(serialized);
function resign(value: BackupDocument) { const { checksum: _ignored, ...body } = value; void _ignored; return JSON.stringify({ ...body, checksum: walletDigest(body) }); }
async function walletExists(store: WalletStore) { return store.transaction(async tx => (await tx.query("SELECT nspname FROM pg_namespace WHERE nspname='alpha_wallet_simulation'")).rows.length > 0); }

describe("V5 strict wallet-only backup", () => {
  it("captures all four continuations, immutable original history and nonfinancial claim/dispute receipts", async () => {
    const inspected = inspectV5WalletBackup(serialized);
    expect(inspected).toMatchObject({ formatVersion: 5, scope: "isolated-v5-ledger", sourcePaused: true,
      initialAcceptanceCount: 1, initialCancellationCount: 0, initialPaymentClaimCount: 1, initialDisputeFreezeCount: 1 });
    const commands = await source.transaction(tx => v3FixtureHistory(tx)); expect(document().commands).toEqual(commands);
    expect(commands.slice(0, fixture.original.snapshot.revision)).toEqual(await source.transaction(tx => v3FixtureHistory(tx, fixture.original.snapshot.revision)));
    expect(inspected.continuation.commandRevision).toBeLessThan(inspected.initialContinuation.commandRevision);
    expect(inspected.initialContinuation.commandRevision).toBeLessThan(inspected.cancellationContinuation.commandRevision);
    expect(inspected.cancellationContinuation.commandRevision).toBeLessThan(inspected.paymentContinuation.commandRevision);
    expect(() => inspectV5WalletBackup(serialized, { expectedChecksum: inspected.checksum })).not.toThrow();
    expect(() => inspectV5WalletBackup(serialized, { expectedChecksum: "f".repeat(64) })).toThrow(/checksum/);
    expect(() => inspectV4WalletBackup(serialized)).toThrow();
    for (const value of ["passwordHash", "bankAccountNumber", "storagePath", "privateKey", "seedPhrase"]) expect(serialized).not.toContain(value);
  });
  it.each([
    ["unknown envelope", (d: BackupDocument) => { d.extra = true; }],
    ["old format", (d: BackupDocument) => { d.formatVersion = 4; }],
    ["combined scope", (d: BackupDocument) => { d.scope = "payment-marketplace-v5-ledger"; }],
    ["production mode", (d: BackupDocument) => { d.mode = "production"; }],
    ["false source pause", (d: BackupDocument) => { d.sourcePaused = false; }],
    ["changed predecessor", (d: BackupDocument) => { d.paymentContinuation.checkpoint.stateHash = "f".repeat(64); }],
    ["changed source halt", (d: BackupDocument) => { d.paymentContinuation.sourceHaltReason = "invented pause"; }],
    ["missing source halt", (d: BackupDocument) => { delete d.paymentContinuation.sourceHaltReason; }],
    ["missing cancellation continuation", (d: BackupDocument) => { delete d.cancellationContinuation; }],
    ["changed historical event", (d: BackupDocument) => { d.commands[0].event_hash = "f".repeat(64); }],
    ["changed original receipt", (d: BackupDocument) => { d.commands.find((r) => r.command_type === "acceptInitialSellerRequest")!.result_json.principalRaw = "1"; }],
    ["changed buyer proof", (d: BackupDocument) => { d.commands.find((r) => r.command_type === "claimInitialPayment")!.command_json.input.claim.proof.contentSha256 = "f".repeat(64); }],
    ["changed buyer authority", (d: BackupDocument) => { d.commands.find((r) => r.command_type === "freezeInitialDispute")!.command_json.actor.kind = "seller"; }],
    ["rebound claim receipt", (d: BackupDocument) => { d.commands.find((r) => r.command_type === "freezeInitialDispute")!.command_json.input.priorClaim.receiptDigest = "f".repeat(64); }],
    ["principal movement", (d: BackupDocument) => { d.commands.find((r) => r.command_type === "claimInitialPayment")!.result_json.transferAmountRaw = "1"; }],
    ["early export", (d: BackupDocument) => { d.exportedAtMs = 0; }],
    ["missing command", (d: BackupDocument) => { d.commands.splice(2, 1); }],
    ["numeric persisted timestamp", (d: BackupDocument) => { d.commands[0].occurred_at_ms = Number(d.commands[0].occurred_at_ms); }],
  ] as const)("rejects %s even with a recomputed outer checksum", (_name, mutate) => {
    const d = document(); mutate(d); expect(() => inspectV5WalletBackup(resign(d))).toThrow();
  });
  it("rejects incomplete, oversized or changed bytes", () => {
    expect(() => inspectV5WalletBackup(serialized.slice(0, -2))).toThrow();
    expect(() => inspectV5WalletBackup("x".repeat(MAX_WALLET_BACKUP_BYTES + 1))).toThrow();
    const d = document(); d.exportedAtMs++; expect(() => inspectV5WalletBackup(JSON.stringify(d))).toThrow(/checksum/);
  });
});

describe("V5 fresh restore and quarantine", () => {
  it("replays each original prefix exactly and adds one V5 quarantine pause", async () => {
    const store = await target(), result = await restore(store), snapshot = await createV5DurableWallet({ mode: MODE, store }).snapshot();
    expect(result.quarantined).toBe(true); expect(result.restored.revision).toBe(fixture.snapshot.revision + 1);
    const rows = await store.transaction(tx => v3FixtureHistory(tx)); expect(rows.slice(0, -1)).toEqual(document().commands);
    expect(rows.at(-1)).toMatchObject({ command_type: "pause", command_key: result.quarantineCommandKey });
    expect(snapshot.state.haltReason).toBeTruthy(); if (!isV5State(snapshot.state) || !isV5State(fixture.snapshot.state)) throw new Error("V5 required");
    expect(snapshot.state.initialPaymentClaimReceipts).toEqual(fixture.snapshot.state.initialPaymentClaimReceipts);
    expect(snapshot.state.initialDisputeFreezeReceipts).toEqual(fixture.snapshot.state.initialDisputeFreezeReceipts);
    expect(snapshot.state.accounts).toEqual(fixture.snapshot.state.accounts); expect(snapshot.state.journal).toEqual(fixture.snapshot.state.journal);
    expect(snapshot.state.payouts.get("withdrawal-v3-fixture-held-withdrawal")).toMatchObject({ state: "submission_unknown", dispatchCount: 1 });
    expect(baseV4StateForV5(snapshot.state)).toEqual(fixture.original.snapshot.state);
    await expect(restore(store)).rejects.toThrow(); expect((await store.transaction(tx => v3FixtureHistory(tx))).length).toBe(rows.length);
  }, TIMEOUT);
  it.each(["missing acknowledgment", "bad checksum", "bad semantics"])("performs no restore writes for %s", async condition => {
    const store = await target(); const d = document(); if (condition === "bad semantics") d.paymentContinuation.commandRevision++;
    await expect(restoreV5WalletBackup({ mode: MODE, store, backup: condition === "bad semantics" ? resign(d) : serialized,
      acknowledgeFreshTarget: (condition !== "missing acknowledgment") as true,
      expectedChecksum: condition === "bad checksum" ? "f".repeat(64) : undefined, clock: () => V3_RESTORE_AT })).rejects.toThrow();
    expect(await walletExists(store)).toBe(false);
  }, TIMEOUT);
  it.each(["claim receipt", "quarantine"])("rolls back the entire restored history after failure at %s", async stage => {
    const store = await target();
    const broken: WalletStore = { transaction: work => store.transaction(tx => work({ async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      const result = await tx.query<Row>(sql, params);
      if (stage === "claim receipt" && sql.includes("INSERT INTO alpha_wallet_simulation.initial_payment_claim_receipts")) throw new Error("restore injected failure");
      if (stage === "quarantine" && sql.includes("INSERT INTO alpha_wallet_simulation.commands") && String(params?.[1]).includes("backup-recovery")) throw new Error("restore injected failure");
      return result;
    }, exec: sql => tx.exec(sql) })), close: async () => undefined };
    await expect(restore(broken)).rejects.toThrow("restore injected failure"); expect(await walletExists(store)).toBe(false);
    expect((await restore(store)).quarantined).toBe(true);
  }, TIMEOUT);
  it("inspects a completed quarantine after lost COMMIT acknowledgment without restoring over it", async () => {
    const store = await target(); let committed = false;
    const uncertain: WalletStore = { transaction: async work => { const result = await store.transaction(work); committed = true; void result; throw new CommitOutcomeUnknownError(new Error("lost actual commit reply")); }, close: async () => undefined };
    await expect(restore(uncertain)).rejects.toBeInstanceOf(CommitOutcomeUnknownError); expect(committed).toBe(true);
    const snapshot = await createV5DurableWallet({ mode: MODE, store }).snapshot(); expect(snapshot.revision).toBe(fixture.snapshot.revision + 1);
    expect(snapshot.state.haltReason).toBeTruthy(); await expect(restore(store)).rejects.toThrow();
    expect(await createV5DurableWallet({ mode: MODE, store }).snapshot()).toEqual(snapshot);
  }, TIMEOUT);
  it("preserves accepted inherited pauses when the last original command is continuation", async () => {
    const pausedSource = await target("paused-source");
    const f = await buildV5PaymentFixture(pausedSource, { sourcePaused: true, claim: false });
    const backup = await exportV5WalletBackup({ mode: MODE, store: pausedSource, clock: () => V3_RESTORE_AT - 1 });
    expect(JSON.parse(backup).commands.at(-1).command_type).toBe("continueFromV4");
    expect(inspectV5WalletBackup(backup).paymentContinuation.sourceHaltReason).toBe("Operator emergency pause");
    const restored = await target("paused-restored"); await restore(restored, backup);
    const snapshot = await createV5DurableWallet({ mode: MODE, store: restored }).snapshot();
    expect(snapshot.state.trades.get(V3_FIXTURE_TRADE)).toMatchObject({ status: "reserved", disputed: false });
    expect(snapshot.state.accounts).toEqual(f.snapshot.state.accounts);
    await expect(createV5DurableWallet({ mode: MODE, store: restored, clock: () => V3_RESTORE_AT + 1 }).execute(f.claimCommand)).rejects.toThrow(/paused/);
  }, TIMEOUT);
  it("restores cancelled sources archivally with their full original V4 cancellation receipt", async () => {
    const archived = await target("cancelled-source"); const f = await buildV5PaymentFixture(archived, { cancelledSource: true, claim: false, pause: true });
    const backup = await exportV5WalletBackup({ mode: MODE, store: archived, clock: () => V3_RESTORE_AT - 1 });
    expect(inspectV5WalletBackup(backup)).toMatchObject({ initialCancellationCount: 1, initialPaymentClaimCount: 0, initialDisputeFreezeCount: 0 });
    const restored = await target("cancelled-target"); await restore(restored, backup);
    const wallet = createV5DurableWallet({ mode: MODE, store: restored, clock: () => V3_RESTORE_AT + 1 }), snapshot = await wallet.snapshot();
    expect(snapshot.state.trades.get(V3_FIXTURE_TRADE)!.status).toBe("cancelled");
    if (!isV5State(snapshot.state) || !isV5State(f.snapshot.state)) throw new Error("V5 required");
    expect(snapshot.state.initialCancellationReceipts).toEqual(f.snapshot.state.initialCancellationReceipts);
    expect((await wallet.execute({ ...f.original.cancellation, requestId: "archive-receipt-recovery" })).replayed).toBe(true);
  }, TIMEOUT);
  it("refuses wallet-only restore into any nonempty companion namespace", async () => {
    const store = await target(); await store.transaction(tx => tx.exec("CREATE SCHEMA alpha_wallet_payment_marketplace_simulation"));
    await expect(restore(store)).rejects.toThrow(/isolated/); expect(await walletExists(store)).toBe(false);
  }, TIMEOUT);
});
