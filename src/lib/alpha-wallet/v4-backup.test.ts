// @vitest-environment node
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SELLER, TRON } from "../../../scripts/alpha-wallet/durable-fixtures";
import { V3_FIXTURE_LISTING, V3_FIXTURE_TRADE, V3_RESTORE_AT, v3FixtureHistory } from "../../../scripts/alpha-wallet/v3-durable-fixtures";
import { buildV4CancellationFixture } from "../../../scripts/alpha-wallet/v4-durable-fixtures";
import { exportWalletBackup, inspectWalletBackup, MAX_WALLET_BACKUP_BYTES } from "./backup";
import { walletDigest, walletJson } from "./commands";
import { initializeDurableWallet } from "./durable";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { balance, expectedCustody } from "./ledger";
import { exportVersionedWalletBackup, inspectVersionedWalletBackup } from "./versioned-backup";
import { exportV3WalletBackup, inspectV3WalletBackup } from "./v3-backup";
import { isV3State } from "./v3-engine";
import { parseV4VersionedCommand, v4Command, WALLET_V4_ENGINE_VERSION } from "./v4-commands";
import { createV4DurableWallet } from "./v4-durable";
import { isV4State } from "./v4-engine";
import { exportV4WalletBackup, inspectV4WalletBackup, restoreV4WalletBackup, WALLET_V4_BACKUP_SCOPE } from "./v4-backup";

const TIMEOUT = 120_000;
const stores: WalletStore[] = [];
let source: WalletStore, sourceDir: string, directory: string;
let fixture: Awaited<ReturnType<typeof buildV4CancellationFixture>>;
let serialized: string;
type BackupDocument = Record<string, unknown> & {
  commands: Array<Record<string, unknown>>; checkpoint: Record<string, unknown>;
  continuation: Record<string, unknown>; initialContinuation: Record<string, unknown>;
  cancellationContinuation: Record<string, unknown>;
};
function runtime() {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE",
    "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
}
beforeAll(async () => {
  runtime();
  sourceDir = await mkdtemp(join(tmpdir(), "alpha-wallet-v4-backup-source-"));
  source = await createFileWalletStore({ mode: "simulation-only", dataDir: sourceDir });
  fixture = await buildV4CancellationFixture(source, { pause: true });
  serialized = await exportV4WalletBackup({ mode: "simulation-only", store: source, clock: () => V3_RESTORE_AT - 1 });
}, TIMEOUT);
beforeEach(async () => {
  runtime();
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-v4-backup-target-"));
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
  return restoreV4WalletBackup({ mode: "simulation-only", store, backup, acknowledgeFreshTarget: true, clock: () => V3_RESTORE_AT });
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

describe("isolated v4 backup identity and semantic validation", () => {
  it("records all three continuations and the complete original prefix in a paused wallet-only format", () => {
    const inspected = inspectV4WalletBackup(serialized);
    expect(inspected).toMatchObject({ formatVersion: 4, scope: WALLET_V4_BACKUP_SCOPE, sourcePaused: true,
      engineVersion: WALLET_V4_ENGINE_VERSION, initialAcceptanceCount: 1, initialCancellationCount: 1,
      commandCount: fixture.snapshot.revision, cancellationContinuation: { sourceHaltReason: null } });
    expect(document().commands.slice(0, fixture.original.prefix.revision)).toEqual(fixture.original.prefixRows);
    expect(inspected.checkpoint).toMatchObject({ revision: fixture.snapshot.revision, eventHash: fixture.snapshot.eventHash,
      stateHash: walletDigest(fixture.snapshot.state) });
    expect(inspected.continuation.commandRevision).toBeLessThan(inspected.initialContinuation.commandRevision);
    expect(inspected.initialContinuation.commandRevision).toBeLessThan(inspected.cancellationContinuation.commandRevision);
    expect(serialized).not.toContain("accountHolderName");
    expect(serialized).not.toContain("passwordHash");
    expect(() => inspectV4WalletBackup(serialized, { expectedChecksum: inspected.checksum })).not.toThrow();
    expect(() => inspectV4WalletBackup(serialized, { expectedChecksum: "0".repeat(64) })).toThrow(/checksum/i);
  });

  it("preserves original acceptance while recording a single full-principal cancellation and held withdrawal", () => {
    const state = fixture.snapshot.state;
    expect(isV4State(state)).toBe(true);
    const original = fixture.original.snapshot.state;
    if (!isV4State(state) || !isV3State(original)) throw new Error("Fixture v3/v4 states required");
    expect(state.initialAcceptanceReceipts).toEqual(original.initialAcceptanceReceipts);
    expect(state.initialBindings).toEqual(original.initialBindings);
    expect(state.initialCancellationReceipts.size).toBe(1);
    expect(balance(state, TRON, `listing:${V3_FIXTURE_LISTING}`)).toBe(BigInt("500000000"));
    expect(balance(state, TRON, `trade:${V3_FIXTURE_TRADE}`)).toBe(BigInt(0));
    expect(balance(state, TRON, `available:${SELLER.id}`)).toBe(BigInt("75000000"));
    expect(expectedCustody(state, TRON)).toBe(BigInt("600000000"));
    expect(fixture.execution?.result).toMatchObject({ actorUserId: SELLER.id,
      principalRaw: "200000000", transferAmountRaw: "200000000", listingAvailableAfterRaw: "500000000" });
    expect(state.payouts.get("withdrawal-v3-fixture-held-withdrawal")).toMatchObject({
      state: "submission_unknown", dispatchCount: 1, amountRaw: BigInt("25000000"),
      providerReference: "sim-payout-withdrawal-v3-fixture-held-withdrawal",
    });
  });

  it.each([
    ["unknown manifest field", (d: BackupDocument) => { d.extra = true; }],
    ["old format marker", (d: BackupDocument) => { d.formatVersion = 3; }],
    ["new format marker", (d: BackupDocument) => { d.formatVersion = 5; }],
    ["canonical bundle scope", (d: BackupDocument) => { d.scope = "canonical-cohort-v1"; }],
    ["false source pause", (d: BackupDocument) => { d.sourcePaused = false; }],
    ["non-simulation mode", (d: BackupDocument) => { d.mode = "production"; }],
    ["changed checkpoint state", (d: BackupDocument) => { d.checkpoint.stateHash = "0".repeat(64); }],
    ["changed checkpoint time", (d: BackupDocument) => { d.checkpoint.lastCommandAtMs = 1; }],
    ["changed first continuation", (d: BackupDocument) => { d.continuation.commandRevision = 1; }],
    ["changed second continuation", (d: BackupDocument) => { d.initialContinuation.commandKey = "unrelated"; }],
    ["changed third continuation", (d: BackupDocument) => { d.cancellationContinuation.commandKey = "unrelated"; }],
    ["changed inherited pause", (d: BackupDocument) => { d.cancellationContinuation.sourceHaltReason = "forged pause"; }],
    ["missing inherited pause", (d: BackupDocument) => { delete d.cancellationContinuation.sourceHaltReason; }],
    ["export before command history", (d: BackupDocument) => { d.exportedAtMs = 0; }],
    ["removed command", (d: BackupDocument) => { d.commands.splice(1, 1); }],
    ["changed original result", (d: BackupDocument) => { d.commands[0]!.result_json = null; }],
    ["changed original event", (d: BackupDocument) => { d.commands[0]!.event_hash = "1".repeat(64); }],
    ["duplicate final command", (d: BackupDocument) => { d.commands.push(structuredClone(d.commands[d.commands.length - 1]!)); }],
    ["changed cancellation actor", (d: BackupDocument) => {
      const command = d.commands.find(row => row.command_type === "cancelInitialTrade")!.command_json as { actor: { id: string } };
      command.actor.id = "unrelated-seller";
    }],
    ["changed returned principal", (d: BackupDocument) => {
      const receipt = d.commands.find(row => row.command_type === "cancelInitialTrade")!.result_json as { transferAmountRaw: string };
      receipt.transferAmountRaw = "199000000";
    }],
    ["numeric stored timestamp", (d: BackupDocument) => { d.commands[0]!.occurred_at_ms = 1; }],
  ] as const)("rejects %s even after a new outer checksum", (_name, mutate) => {
    const value = document(); mutate(value);
    expect(() => inspectV4WalletBackup(resign(value))).toThrow();
  });

  it("rejects truncated/oversized JSON and an unresealed byte change", () => {
    expect(() => inspectV4WalletBackup(serialized.slice(0, -5))).toThrow();
    expect(() => inspectV4WalletBackup("x".repeat(MAX_WALLET_BACKUP_BYTES + 1))).toThrow();
    const value = document(); value.exportedAtMs = V3_RESTORE_AT + 1;
    expect(() => inspectV4WalletBackup(JSON.stringify(value))).toThrow(/checksum/i);
  });

  it("does not reinterpret old backups or allow any old reader to interpret v4", () => {
    for (const path of ["./fixtures/v1/settlement-and-held-withdrawal.backup.json",
      "./fixtures/v2/corrections-and-settlement.backup.json", "./fixtures/v3/initial-acceptance.backup.json"]) {
      expect(() => inspectV4WalletBackup(readFileSync(new URL(path, import.meta.url), "utf8"))).toThrow();
    }
    expect(() => inspectWalletBackup(serialized)).toThrow();
    expect(() => inspectVersionedWalletBackup(serialized)).toThrow();
    expect(() => inspectV3WalletBackup(serialized)).toThrow();
  });

  it("captures invalid restore decisions before any target schema work and reports them inside a certified owner", async () => {
    const { store } = await target(), statements: string[] = [];
    const observed: WalletStore = { close: async () => undefined, transaction: work => store.transaction(tx => work({
      query: (sql, params) => { statements.push(sql); return tx.query(sql, params); },
      exec: sql => { statements.push(sql); return tx.exec(sql); },
    })) };
    const value = document(); value.checkpoint.stateHash = "f".repeat(64);
    await expect(restore(observed, resign(value))).rejects.toThrow();
    await expect(restoreV4WalletBackup({ mode: "simulation-only", store: observed, backup: serialized,
      acknowledgeFreshTarget: false as true, clock: () => V3_RESTORE_AT })).rejects.toThrow(/acknowledgment/);
    await expect(restoreV4WalletBackup({ mode: "simulation-only", store: observed, backup: serialized,
      acknowledgeFreshTarget: true, clock: () => 1 })).rejects.toThrow(/clock/);
    expect(statements.filter(sql => sql.includes("current_setting('transaction_isolation')"))).toHaveLength(6);
    expect(statements.filter(sql => sql.includes("abort failed isolated v4 recovery participant"))).toHaveLength(3);
    expect(statements.every(sql => sql.includes("txid_current()") || sql.includes("SELECT 1 / 0"))).toBe(true);
    expect(await hasWallet(store)).toBe(false);
  }, TIMEOUT);
});

describe("v4 source and fresh-target recovery boundaries", () => {
  it.each(["acknowledgment", "document", "checksum", "clock", "throwing-clock"] as const)(
    "a caught %s preflight refusal rolls back companion writes in the same physical owner", async failure => {
      const { store } = await target();
      await store.transaction(tx => tx.exec("CREATE TABLE public.restore_preflight_probe(value integer NOT NULL); INSERT INTO public.restore_preflight_probe VALUES(0)"));
      let caught = false;
      await expect(store.transaction(async tx => {
        await tx.exec("UPDATE public.restore_preflight_probe SET value=1");
        try {
          await restoreV4WalletBackup({ mode: "simulation-only", store: bound(tx),
            backup: failure === "document" ? "not-a-json-backup" : serialized,
            acknowledgeFreshTarget: (failure !== "acknowledgment") as true,
            expectedChecksum: failure === "checksum" ? "0".repeat(64) : undefined,
            clock: failure === "throwing-clock" ? () => { throw new Error("Injected clock refusal"); }
              : () => failure === "clock" ? 1 : V3_RESTORE_AT });
        } catch { caught = true; }
      })).rejects.toThrow();
      expect(caught).toBe(true);
      expect(await store.transaction(async tx => (await tx.query("SELECT value FROM public.restore_preflight_probe")).rows)).toEqual([{ value: 0 }]);
      expect(await hasWallet(store)).toBe(false);
    }, TIMEOUT);

  it("captures backup, acknowledgment, expected checksum, target and evaluated clock before the owner yields", async () => {
    const { store } = await target();
    const replacement = { transaction: vi.fn(), close: async () => undefined } as WalletStore;
    let time = V3_RESTORE_AT;
    const clock = vi.fn(() => time);
    const options: Parameters<typeof restoreV4WalletBackup>[0] = { mode: "simulation-only", store, backup: serialized,
      acknowledgeFreshTarget: true, expectedChecksum: inspectV4WalletBackup(serialized).checksum, clock };
    options.store = { close: async () => undefined, transaction: work => {
      options.store = replacement; options.backup = "changed-after-capture"; options.acknowledgeFreshTarget = false as true;
      options.expectedChecksum = "0".repeat(64); options.clock = () => 1; time = 1;
      return store.transaction(work);
    } };
    const result = await restoreV4WalletBackup(options);
    expect(result.quarantined).toBe(true); expect(result.restored.lastCommandAtMs).toBe(V3_RESTORE_AT);
    expect(result.backup.checksum).toBe(inspectV4WalletBackup(serialized).checksum);
    expect(clock).toHaveBeenCalledTimes(1); expect(replacement.transaction).not.toHaveBeenCalled();
    expect(await hasWallet(store)).toBe(true);
  }, TIMEOUT);

  it("does not abort a replacement transaction while reporting a captured refusal", async () => {
    const statements: string[] = [];
    const tx: WalletSql = { exec: async () => { throw new Error("Unexpected restore SQL"); },
      query: async <Row extends Record<string, unknown>>(sql: string) => {
        statements.push(sql);
        if (sql.includes("current_setting('transaction_isolation')")) return { rows: [{ transaction_id: "101",
          isolation: "serializable", read_only: "off", development_mode: "simulation-only" }] as unknown as Row[] };
        if (sql === "SELECT txid_current()::text AS transaction_id") return { rows: [{ transaction_id: "202" }] as unknown as Row[] };
        throw new Error("Unexpected physical transaction abort");
      } };
    await expect(restoreV4WalletBackup({ mode: "simulation-only", store: bound(tx), backup: serialized,
      acknowledgeFreshTarget: false as true, clock: () => V3_RESTORE_AT })).rejects.toThrow(/acknowledgment/);
    expect(statements).toHaveLength(3);
    expect(statements.some(sql => sql.includes("SELECT 1 / 0"))).toBe(false);
  });

  it("restores all four histories, quarantines, reopens, and retries cancellation and dispatch without repeating effects", async () => {
    const opened = await target();
    const result = await restore(opened.store);
    expect(result.quarantined).toBe(true);
    expect(result.restored.revision).toBe(fixture.snapshot.revision + 1);
    expect(await opened.store.transaction(tx => v3FixtureHistory(tx, fixture.snapshot.revision))).toEqual(document().commands);
    await opened.store.close(); stores.splice(stores.indexOf(opened.store), 1);
    const reopened = await createFileWalletStore({ mode: "simulation-only", dataDir: opened.dataDir }); stores.push(reopened);
    const wallet = createV4DurableWallet({ mode: "simulation-only", store: reopened, clock: () => V3_RESTORE_AT + 1 });
    const snapshot = await wallet.snapshot();
    expect(snapshot.state.haltReason).toBeTruthy();
    expect(walletDigest(snapshot.state)).toBe(result.restored.stateHash);
    for (const row of document().commands) {
      const command = parseV4VersionedCommand(row.command_json), replay = await wallet.execute(command);
      expect(replay).toMatchObject({ replayed: true, revision: row.revision, commandKey: row.command_key, eventHash: row.event_hash });
      if (command.type === "beginDispatch") expect(replay.result).toMatchObject({ shouldDispatch: false,
        payout: { state: "submission_unknown", dispatchCount: 1 } });
      else expect(walletJson(replay.result)).toEqual(row.result_json);
    }
    expect(await wallet.execute({ ...fixture.cancellation, requestId: "v4-backup-alternate-operation" }))
      .toEqual({ ...fixture.execution, replayed: true });
    expect(await wallet.execute({ ...fixture.original.acceptance, requestId: "v4-backup-original-acceptance" }))
      .toEqual({ ...fixture.original.execution, replayed: true });
    await expect(wallet.execute(v4Command("cancelInitialTrade", { kind: "seller", id: "other-seller" },
      "wrong-actor-recovery", fixture.cancellation.input))).rejects.toThrow();
    expect(await wallet.recoverPayouts()).toEqual(expect.arrayContaining([expect.objectContaining({ action: "lookup_original_reference" })]));
    await expect(restore(reopened)).rejects.toThrow();
    expect(await wallet.snapshot()).toEqual(snapshot);
  }, TIMEOUT);

  it("preserves a pause inherited from v3 without inventing a cancellation or resume", async () => {
    const prior = await target("inherited-source");
    const paused = await buildV4CancellationFixture(prior.store, { sourcePaused: true, cancel: false });
    const backup = await exportV4WalletBackup({ mode: "simulation-only", store: prior.store, clock: () => V3_RESTORE_AT - 1 });
    expect(inspectV4WalletBackup(backup)).toMatchObject({ initialCancellationCount: 0,
      cancellationContinuation: { sourceHaltReason: "Operator emergency pause" } });
    const fresh = await target("inherited-target");
    await restore(fresh.store, backup);
    const wallet = createV4DurableWallet({ mode: "simulation-only", store: fresh.store, clock: () => V3_RESTORE_AT + 1 });
    const before = await wallet.snapshot();
    await expect(wallet.execute(paused.cancellation)).rejects.toThrow();
    expect(before.state.haltReason).toBeTruthy();
    expect(balance(before.state, TRON, `trade:${V3_FIXTURE_TRADE}`)).toBe(BigInt("200000000"));
    expect(await wallet.snapshot()).toEqual(before);
  }, TIMEOUT);

  it("refuses an unpaused export and never upgrades an original store", async () => {
    const { store } = await target("unpaused");
    const unpaused = await buildV4CancellationFixture(store, { unknownWithdrawal: false });
    await expect(exportV4WalletBackup({ mode: "simulation-only", store, clock: () => V3_RESTORE_AT })).rejects.toThrow(/paused/);
    expect(walletDigest((await unpaused.wallet.snapshot()).state)).toBe(walletDigest(unpaused.snapshot.state));
    const old = await target("v1"); await initializeDurableWallet(old.store);
    await expect(exportV4WalletBackup({ mode: "simulation-only", store: old.store })).rejects.toThrow();
    expect(await old.store.transaction(async tx => (await tx.query("SELECT format_version FROM alpha_wallet_simulation.head")).rows))
      .toEqual([{ format_version: 1 }]);
    await expect(exportWalletBackup({ mode: "simulation-only", store: source })).rejects.toThrow();
    await expect(exportVersionedWalletBackup({ mode: "simulation-only", store: source })).rejects.toThrow();
    await expect(exportV3WalletBackup({ mode: "simulation-only", store: source })).rejects.toThrow();
  }, TIMEOUT);

  it.each(["alpha_exchange", "alpha_wallet_marketplace_simulation"])("rejects export and restore beside even an empty %s schema", async schema => {
    const before = walletDigest((await fixture.wallet.snapshot()).state);
    await expect(source.transaction(async tx => {
      await tx.exec(`CREATE SCHEMA ${schema}`);
      await exportV4WalletBackup({ mode: "simulation-only", store: bound(tx), clock: () => V3_RESTORE_AT });
    })).rejects.toThrow(/isolated|coordinat/i);
    expect(walletDigest((await fixture.wallet.snapshot()).state)).toBe(before);
    const fresh = await target();
    await fresh.store.transaction(tx => tx.exec(`CREATE SCHEMA ${schema}`));
    await expect(restore(fresh.store)).rejects.toThrow(/isolated|coordinat/i);
    expect(await hasWallet(fresh.store)).toBe(false);
  }, TIMEOUT);

  it("preserves unrelated public target data", async () => {
    const { store } = await target();
    await store.transaction(tx => tx.exec("CREATE TABLE public.keep_me(id integer PRIMARY KEY); INSERT INTO public.keep_me VALUES(7)"));
    await expect(restore(store)).rejects.toThrow(/isolated/);
    expect(await store.transaction(async tx => (await tx.query("SELECT id FROM keep_me")).rows)).toEqual([{ id: 7 }]);
    expect(await hasWallet(store)).toBe(false);
  }, TIMEOUT);

  it("rolls back every schema, upgrade and financial write if the final quarantine write fails", async () => {
    const { store } = await target();
    let injected = false;
    const failed: WalletStore = { close: async () => undefined, transaction: work => store.transaction(tx => work({
      query: async (sql, params) => {
        if (sql.startsWith("INSERT INTO alpha_wallet_simulation.commands") && String(params?.[1]).includes("backup-recovery")) {
          injected = true; return tx.query("SELECT 1 / 0 /* fail final v4 restore quarantine */");
        }
        return tx.query(sql, params);
      }, exec: sql => tx.exec(sql),
    })) };
    await expect(restore(failed)).rejects.toThrow();
    expect(injected).toBe(true);
    expect(await hasWallet(store)).toBe(false);
    expect((await restore(store)).quarantined).toBe(true);
  }, TIMEOUT);

  it("a swallowed semantic failure after all restore writes still aborts the physical owner", async () => {
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
      try { await restore(bound(adapter)); } catch { /* The physical owner must refuse COMMIT even if the caller swallows this. */ }
    })).rejects.toThrow();
    expect(finalCheck).toBe(true);
    expect(await hasWallet(store)).toBe(false);
  }, TIMEOUT);

  it("a lost reply after actual commit is resolved on the same paused target without overwriting it", async () => {
    const { store } = await target();
    let committed = false;
    const lost: WalletStore = { close: async () => undefined, transaction: async work => {
      await store.transaction(work); committed = true;
      throw new CommitOutcomeUnknownError(new Error("Injected lost reply after actual v4 restore commit"));
    } };
    await expect(restore(lost)).rejects.toBeInstanceOf(CommitOutcomeUnknownError);
    expect(committed).toBe(true);
    const wallet = createV4DurableWallet({ mode: "simulation-only", store });
    const snapshot = await wallet.snapshot();
    expect(snapshot.revision).toBe(fixture.snapshot.revision + 1);
    expect(snapshot.state.haltReason).toBeTruthy();
    expect((await wallet.execute(fixture.cancellation)).replayed).toBe(true);
    await expect(restore(store)).rejects.toThrow();
    expect(await wallet.snapshot()).toEqual(snapshot);
  }, TIMEOUT);

  it("exports an existing pause deterministically without appending another command", async () => {
    const before = await fixture.wallet.snapshot();
    expect(await exportV4WalletBackup({ mode: "simulation-only", store: source, clock: () => V3_RESTORE_AT - 1 })).toBe(serialized);
    expect(await fixture.wallet.snapshot()).toEqual(before);
    await expect(fixture.wallet.execute(v4Command("pause", { kind: "seller", id: SELLER.id }, "seller-pause-forbidden", null)))
      .rejects.toThrow();
  }, TIMEOUT);
});
