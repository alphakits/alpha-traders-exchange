// @vitest-environment node
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SELLER, TRON } from "../../../scripts/alpha-wallet/durable-fixtures";
import { buildV3AcceptanceFixture, V3_FIXTURE_LISTING, V3_FIXTURE_TRADE, V3_RESTORE_AT,
  v3FixtureHistory } from "../../../scripts/alpha-wallet/v3-durable-fixtures";
import { exportWalletBackup, inspectWalletBackup, MAX_WALLET_BACKUP_BYTES } from "./backup";
import { walletDigest } from "./commands";
import { initializeDurableWallet } from "./durable";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { balance } from "./ledger";
import { exportVersionedWalletBackup, inspectVersionedWalletBackup } from "./versioned-backup";
import { v3Command, WALLET_V3_ENGINE_VERSION } from "./v3-commands";
import { createV3DurableWallet } from "./v3-durable";
import { isV3State } from "./v3-engine";
import { exportV3WalletBackup, inspectV3WalletBackup, restoreV3WalletBackup, WALLET_V3_BACKUP_SCOPE } from "./v3-backup";

const TIMEOUT = 120_000;
const stores: WalletStore[] = [];
let source: WalletStore, sourceDir: string, directory: string;
let fixture: Awaited<ReturnType<typeof buildV3AcceptanceFixture>>;
let serialized: string;
type BackupDocument = Record<string, unknown> & {
  commands: Array<Record<string, unknown>>; checkpoint: Record<string, unknown>;
  continuation: Record<string, unknown>; initialContinuation: Record<string, unknown>;
};
function runtime() {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE",
    "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
}
beforeAll(async () => {
  runtime();
  sourceDir = await mkdtemp(join(tmpdir(), "alpha-wallet-v3-backup-source-"));
  source = await createFileWalletStore({ mode: "simulation-only", dataDir: sourceDir });
  fixture = await buildV3AcceptanceFixture(source, { pause: true });
  serialized = await exportV3WalletBackup({ mode: "simulation-only", store: source, clock: () => V3_RESTORE_AT - 1 });
}, TIMEOUT);
beforeEach(async () => {
  runtime();
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-v3-backup-target-"));
});
afterEach(async () => {
  try { await Promise.allSettled(stores.splice(0).map(store => store.close())); }
  finally { if (directory) await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
}, TIMEOUT);
afterAll(async () => {
  runtime();
  try { if (source) await source.close(); }
  finally { if (sourceDir) await rm(sourceDir, { recursive: true, force: true }); vi.unstubAllEnvs(); }
}, TIMEOUT);
async function target(name = "target") {
  const dataDir = join(directory, name), store = await createFileWalletStore({ mode: "simulation-only", dataDir });
  stores.push(store);
  return { store, dataDir };
}
function bound(tx: WalletSql): WalletStore { return { transaction: work => work(tx), close: async () => undefined }; }
function restore(store: WalletStore, backup = serialized) {
  return restoreV3WalletBackup({ mode: "simulation-only", store, backup, acknowledgeFreshTarget: true, clock: () => V3_RESTORE_AT });
}
function document(): BackupDocument { return JSON.parse(serialized) as BackupDocument; }
function resign(value: BackupDocument) {
  const { checksum: _checksum, ...body } = value;
  void _checksum;
  return JSON.stringify({ ...body, checksum: walletDigest(body) });
}
async function hasWallet(store: WalletStore) {
  return store.transaction(async tx => (await tx.query("SELECT nspname FROM pg_namespace WHERE nspname='alpha_wallet_simulation'")).rows.length > 0);
}

describe("isolated v3 backup identity and semantic validation", () => {
  it("records both exact continuations, all original rows, and a paused wallet-only scope", () => {
    const inspected = inspectV3WalletBackup(serialized);
    expect(inspected).toMatchObject({ formatVersion: 3, scope: WALLET_V3_BACKUP_SCOPE, sourcePaused: true,
      engineVersion: WALLET_V3_ENGINE_VERSION, initialAcceptanceCount: 1, commandCount: fixture.snapshot.revision });
    expect(document().commands.slice(0, fixture.prefix.revision)).toEqual(fixture.prefixRows);
    expect(inspected.checkpoint).toMatchObject({ revision: fixture.snapshot.revision, eventHash: fixture.snapshot.eventHash,
      stateHash: walletDigest(fixture.snapshot.state) });
    expect(serialized).not.toContain("accountHolderName");
    expect(serialized).not.toContain("passwordHash");
    expect(() => inspectV3WalletBackup(serialized, { expectedChecksum: inspected.checksum })).not.toThrow();
    expect(() => inspectV3WalletBackup(serialized, { expectedChecksum: "0".repeat(64) })).toThrow(/checksum/i);
  });
  it("retains full principal at the request price and separately recorded buyer evidence", () => {
    const state = fixture.snapshot.state;
    expect(isV3State(state)).toBe(true);
    if (!isV3State(state)) throw new Error("Fixture v3 state required");
    expect(balance(state, TRON, `listing:${V3_FIXTURE_LISTING}`)).toBe(BigInt(300_000_000));
    expect(balance(state, TRON, `trade:${V3_FIXTURE_TRADE}`)).toBe(BigInt(200_000_000));
    expect(state.listings.get(V3_FIXTURE_LISTING)?.price).toBe("3.20");
    expect(fixture.acceptance.input.terms.pricePerUsdt).toBe("3.10");
    expect(fixture.acceptance.input.pricing.requiresFrozenPriceTransition).toBe(true);
    expect(fixture.execution?.result.actorUserId).toBe(SELLER.id);
    expect(fixture.execution?.result.buyerId).toBe(fixture.acceptance.input.buyerRequestEvidence.buyerId);
  });
  it.each([
    ["unknown manifest field", (d: BackupDocument) => { d.extra = true; }],
    ["old format marker", (d: BackupDocument) => { d.formatVersion = 2; }],
    ["new format marker", (d: BackupDocument) => { d.formatVersion = 4; }],
    ["canonical bundle scope", (d: BackupDocument) => { d.scope = "canonical-cohort-v1"; }],
    ["false source pause", (d: BackupDocument) => { d.sourcePaused = false; }],
    ["non-simulation mode", (d: BackupDocument) => { d.mode = "production"; }],
    ["changed checkpoint state", (d: BackupDocument) => { d.checkpoint.stateHash = "0".repeat(64); }],
    ["changed checkpoint time", (d: BackupDocument) => { d.checkpoint.lastCommandAtMs = 1; }],
    ["changed first continuation", (d: BackupDocument) => { d.continuation.commandRevision = 1; }],
    ["changed second continuation", (d: BackupDocument) => { d.initialContinuation.commandKey = "unrelated"; }],
    ["export before command history", (d: BackupDocument) => { d.exportedAtMs = 0; }],
    ["removed command", (d: BackupDocument) => { d.commands.splice(1, 1); }],
    ["changed original result", (d: BackupDocument) => { d.commands[0]!.result_json = null; }],
    ["changed original event", (d: BackupDocument) => { d.commands[0]!.event_hash = "1".repeat(64); }],
    ["duplicate final command", (d: BackupDocument) => { d.commands.push(structuredClone(d.commands[d.commands.length - 1]!)); }],
    ["changed seller actor", (d: BackupDocument) => {
      const command = d.commands.find(row => row.command_type === "acceptInitialSellerRequest")!.command_json as { actor: { kind: string } };
      command.actor.kind = "buyer";
    }],
    ["numeric stored timestamp", (d: BackupDocument) => { d.commands[0]!.occurred_at_ms = 1; }],
  ] as const)("rejects %s even after a new outer checksum", (_name, mutate) => {
    const value = document(); mutate(value);
    expect(() => inspectV3WalletBackup(resign(value))).toThrow();
  });
  it("rejects truncated/oversized JSON and an unresealed byte change", () => {
    expect(() => inspectV3WalletBackup(serialized.slice(0, -5))).toThrow();
    expect(() => inspectV3WalletBackup("x".repeat(MAX_WALLET_BACKUP_BYTES + 1))).toThrow();
    const value = document(); value.exportedAtMs = V3_RESTORE_AT + 1;
    expect(() => inspectV3WalletBackup(JSON.stringify(value))).toThrow(/checksum/i);
  });
  it("does not reinterpret v1/v2 files or allow old readers to interpret v3", () => {
    for (const path of ["./fixtures/v1/settlement-and-held-withdrawal.backup.json", "./fixtures/v2/corrections-and-settlement.backup.json"]) {
      expect(() => inspectV3WalletBackup(readFileSync(new URL(path, import.meta.url), "utf8"))).toThrow();
    }
    expect(() => inspectWalletBackup(serialized)).toThrow();
    expect(() => inspectVersionedWalletBackup(serialized)).toThrow();
  });
  it("validates the entire document before touching a restore target", async () => {
    const transaction = vi.fn(), store = { transaction, close: async () => undefined } as WalletStore;
    const value = document(); value.checkpoint.stateHash = "f".repeat(64);
    await expect(restore(store, resign(value))).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
    await expect(restoreV3WalletBackup({ mode: "simulation-only", store, backup: serialized,
      acknowledgeFreshTarget: false as true, clock: () => V3_RESTORE_AT })).rejects.toThrow(/acknowledgment/);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("v3 source and fresh-target recovery boundaries", () => {
  it("restores all three histories exactly, quarantines, reopens, and recovers original identities without dispatch", async () => {
    const opened = await target();
    const result = await restore(opened.store);
    expect(result.quarantined).toBe(true);
    expect(result.restored.revision).toBe(fixture.snapshot.revision + 1);
    expect(await opened.store.transaction(tx => v3FixtureHistory(tx, fixture.snapshot.revision))).toEqual(document().commands);
    await opened.store.close(); stores.splice(stores.indexOf(opened.store), 1);
    const reopened = await createFileWalletStore({ mode: "simulation-only", dataDir: opened.dataDir }); stores.push(reopened);
    const wallet = createV3DurableWallet({ mode: "simulation-only", store: reopened, clock: () => V3_RESTORE_AT + 1 });
    const snapshot = await wallet.snapshot();
    expect(snapshot.state.haltReason).toBeTruthy();
    expect(walletDigest(snapshot.state)).toBe(result.restored.stateHash);
    const replay = await wallet.execute({ ...fixture.acceptance, requestId: "v3-backup-alternate-operation" });
    expect(replay).toEqual({ ...fixture.execution, replayed: true });
    expect(fixture.historicalDispatch).toBeDefined();
    const dispatch = await wallet.execute(fixture.historicalDispatch!);
    expect(dispatch.result).toMatchObject({ shouldDispatch: false, payout: { state: "submission_unknown", dispatchCount: 1 } });
    await expect(wallet.execute(v3Command("acceptInitialSellerRequest", { kind: "seller", id: "other-seller" },
      "wrong-actor-recovery", fixture.acceptance.input))).rejects.toThrow();
    expect((await wallet.snapshot()).revision).toBe(snapshot.revision);
    expect(await wallet.recoverPayouts()).toEqual(expect.arrayContaining([expect.objectContaining({ action: "lookup_original_reference" })]));
    await expect(restore(reopened)).rejects.toThrow();
    expect(walletDigest((await wallet.snapshot()).state)).toBe(result.restored.stateHash);
  }, TIMEOUT);
  it("refuses to export an unpaused source and never upgrades an original store", async () => {
    const { store } = await target("unpaused");
    const unpaused = await buildV3AcceptanceFixture(store, { unknownWithdrawal: false });
    await expect(exportV3WalletBackup({ mode: "simulation-only", store, clock: () => V3_RESTORE_AT })).rejects.toThrow(/paused/);
    expect(walletDigest((await unpaused.wallet.snapshot()).state)).toBe(walletDigest(unpaused.snapshot.state));
    const old = await target("v1"); await initializeDurableWallet(old.store);
    await expect(exportV3WalletBackup({ mode: "simulation-only", store: old.store })).rejects.toThrow();
    expect(await old.store.transaction(async tx => (await tx.query("SELECT format_version FROM alpha_wallet_simulation.head")).rows))
      .toEqual([{ format_version: 1 }]);
    await expect(exportWalletBackup({ mode: "simulation-only", store: source })).rejects.toThrow();
    await expect(exportVersionedWalletBackup({ mode: "simulation-only", store: source })).rejects.toThrow();
  }, TIMEOUT);
  it.each(["alpha_exchange", "alpha_wallet_marketplace_simulation"])("rejects wallet-only export beside even an empty %s schema", async schema => {
    const before = walletDigest((await fixture.wallet.snapshot()).state);
    await expect(source.transaction(async tx => {
      await tx.exec(`CREATE SCHEMA ${schema}`);
      await exportV3WalletBackup({ mode: "simulation-only", store: bound(tx), clock: () => V3_RESTORE_AT });
    })).rejects.toThrow(/isolated|coordinat/i);
    expect(walletDigest((await fixture.wallet.snapshot()).state)).toBe(before);
  }, TIMEOUT);
  it("refuses unrelated target data and preserves it", async () => {
    const { store } = await target();
    await store.transaction(tx => tx.exec("CREATE TABLE public.keep_me(id integer PRIMARY KEY); INSERT INTO public.keep_me VALUES(7)"));
    await expect(restore(store)).rejects.toThrow(/isolated/);
    expect(await store.transaction(async tx => (await tx.query("SELECT id FROM public.keep_me")).rows)).toEqual([{ id: 7 }]);
    expect(await hasWallet(store)).toBe(false);
  }, TIMEOUT);
  it("rolls back schema, both upgrades and all prior financial writes when the quarantine write fails", async () => {
    const { store } = await target();
    let injected = false;
    const failed: WalletStore = { close: async () => undefined, transaction: work => store.transaction(tx => work({
      query: async (sql, params) => {
        if (sql.startsWith("INSERT INTO alpha_wallet_simulation.commands") && String(params?.[1]).includes("backup-recovery")) {
          injected = true; return tx.query("SELECT 1 / 0 /* fail final v3 restore quarantine */");
        }
        return tx.query(sql, params);
      }, exec: sql => tx.exec(sql),
    })) };
    await expect(restore(failed)).rejects.toThrow();
    expect(injected).toBe(true);
    expect(await hasWallet(store)).toBe(false);
    expect((await restore(store)).quarantined).toBe(true);
  }, TIMEOUT);
  it("a swallowed semantic failure after all restore writes still prevents the outer owner from committing", async () => {
    const { store } = await target();
    let finalCheck = false;
    await expect(store.transaction(async tx => {
      let reads = 0;
      const adapter: WalletSql = { exec: sql => tx.exec(sql), query: async <Row extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
        if (sql.includes("nspname NOT IN ('pg_catalog','information_schema','public','alpha_wallet_simulation')") && ++reads === 2) {
          finalCheck = true;
          return { rows: [{ nspname: "synthetic_late_companion" }] as unknown as Row[] };
        }
        return tx.query<Row>(sql, params);
      } };
      try { await restore(bound(adapter)); } catch { /* Deliberately swallow; the physical owner must refuse COMMIT. */ }
    })).rejects.toThrow();
    expect(finalCheck).toBe(true);
    expect(await hasWallet(store)).toBe(false);
  }, TIMEOUT);
  it("a lost acknowledgment after actual commit is resolved by inspecting the same paused target", async () => {
    const { store } = await target();
    let committed = false;
    const lost: WalletStore = { close: async () => undefined, transaction: async work => {
      await store.transaction(work); committed = true;
      throw new CommitOutcomeUnknownError(new Error("Injected lost reply after actual restore commit"));
    } };
    await expect(restore(lost)).rejects.toBeInstanceOf(CommitOutcomeUnknownError);
    expect(committed).toBe(true);
    const wallet = createV3DurableWallet({ mode: "simulation-only", store });
    const snapshot = await wallet.snapshot();
    expect(snapshot.revision).toBe(fixture.snapshot.revision + 1);
    expect(snapshot.state.haltReason).toBeTruthy();
    expect((await wallet.execute(fixture.acceptance)).replayed).toBe(true);
    await expect(restore(store)).rejects.toThrow();
    expect(walletDigest((await wallet.snapshot()).state)).toBe(walletDigest(snapshot.state));
  }, TIMEOUT);
  it("an existing paused source can be exported deterministically without appending another pause", async () => {
    const before = await fixture.wallet.snapshot();
    const second = await exportV3WalletBackup({ mode: "simulation-only", store: source, clock: () => V3_RESTORE_AT - 1 });
    expect(second).toBe(serialized);
    expect((await fixture.wallet.snapshot()).revision).toBe(before.revision);
    await expect(fixture.wallet.execute(v3Command("pause", { kind: "seller", id: SELLER.id }, "seller-pause-forbidden", null))).rejects.toThrow();
  }, TIMEOUT);
});
