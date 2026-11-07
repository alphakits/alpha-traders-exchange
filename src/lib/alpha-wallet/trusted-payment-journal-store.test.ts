// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrustedPaymentFixture } from "./trusted-payment-fixture";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { walletDigest } from "./commands";
import type { TrustedPaymentJournalArchive } from "./trusted-payment-journal-model";
import {
  createDevelopmentTrustedPaymentJournal, initializeDevelopmentTrustedPaymentJournal, restoreDevelopmentTrustedPaymentJournal,
  TRUSTED_PAYMENT_JOURNAL_SCHEMA as SCHEMA, TrustedPaymentJournalCommittedResponseUnavailableError,
  type TrustedPaymentJournalUnknownCommand,
} from "./trusted-payment-journal-store";

const MODE = "simulation-only" as const, TIMEOUT = 120_000;
let directory: string, ordinal = 0;
const stores: WalletStore[] = [];
type Row = Record<string, unknown>;
function runtime() {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("TZ", "UTC");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"])
    vi.stubEnv(key, undefined);
}
function wrapped(store: WalletStore, adapt: (tx: WalletSql) => WalletSql): WalletStore {
  return { transaction: work => store.transaction(tx => work(adapt(tx))), close: async () => undefined };
}
function bound(tx: WalletSql): WalletStore { return { transaction: work => work(tx), close: async () => undefined }; }
async function empty() {
  const storeId = `fiat_test_${++ordinal}`, dataDir = join(directory, storeId);
  const store = await createFileWalletStore({ mode: MODE, dataDir }); stores.push(store); return { store, storeId, dataDir };
}
async function fresh(method: "Bank Transfer" | "Face-to-Face (Meet in Person)" = "Bank Transfer") {
  const fixture = createTrustedPaymentFixture({ method }), target = await empty();
  const initialized = await initializeDevelopmentTrustedPaymentJournal({ mode: MODE, store: target.store,
    manifest: fixture.manifest, sourceStoreId: target.storeId, clock: fixture.now });
  const make = (store = target.store, storeId = target.storeId) => createDevelopmentTrustedPaymentJournal({ mode: MODE,
    store, manifest: fixture.manifest, storeId, clock: fixture.now });
  const prepared = await fixture.reader().prepare(fixture.request);
  return { ...target, fixture, initialized, prepared, make, journal: make() };
}
async function noSchema(store: WalletStore) {
  return store.transaction(async tx => (await tx.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%'")).rows);
}
function forgedAppend(before: TrustedPaymentJournalArchive, command: { operationId: string; type: string; prepared?: unknown },
  status: "recording" | null = "recording") {
  const revision = before.checkpoint.revision + 1, occurredAtMs = before.checkpoint.lastCommandAtMs;
  const state = { ...before.state, status, haltReason: null }, stateHash = walletDigest(state), inputHash = walletDigest(command);
  const event = { revision, operationId: command.operationId, inputHash, occurredAtMs,
    previousEventHash: before.checkpoint.eventHash, stateHash, disposition: "recorded", status };
  const eventHash = walletDigest(event), receipt = { operationId: command.operationId, inputHash, revision, eventHash, stateHash,
    disposition: "recorded", status, executionAuthority: false, releaseAuthority: false };
  const record = { revision, operationId: command.operationId, inputHash, command, occurredAtMs,
    previousEventHash: before.checkpoint.eventHash, eventHash, stateHash, receipt };
  const body = { kind: before.kind, formatVersion: before.formatVersion, mode: before.mode, bootstrap: before.bootstrap,
    records: [...before.records, record], checkpoint: { revision, eventHash, stateHash, lastCommandAtMs: occurredAtMs }, state };
  return { ...body, archiveSha256: walletDigest(body) };
}
async function insertDirect(tx: WalletSql, after: ReturnType<typeof forgedAppend>, didInsert: () => void) {
  const record = after.records.at(-1)!;
  await tx.query(`UPDATE ${SCHEMA}.head SET lock_version=lock_version+1,owner_transaction_id=txid_current()::text WHERE singleton`);
  await tx.query(`INSERT INTO ${SCHEMA}.commands(revision,operation_id,input_hash,record_json,owner_transaction_id)
    VALUES($1,$2,$3,$4::jsonb,txid_current()::text)`, [record.revision, record.operationId, record.inputHash, JSON.stringify(record)]);
  didInsert();
  await tx.query(`UPDATE ${SCHEMA}.head SET archive_json=$1::jsonb,revision=$2,event_hash=$3,state_hash=$4,archive_sha256=$5 WHERE singleton`,
    [JSON.stringify(after), after.checkpoint.revision, after.checkpoint.eventHash, after.checkpoint.stateHash, after.archiveSha256]);
}
beforeAll(async () => { runtime(); directory = await mkdtemp(join(tmpdir(), "alpha-fiat-journal-store-")); });
beforeEach(runtime);
afterEach(async () => {
  const results = await Promise.allSettled(stores.splice(0).map(store => store.close()));
  expect(results.every(result => result.status === "fulfilled")).toBe(true);
  vi.restoreAllMocks(); vi.unstubAllEnvs();
}, TIMEOUT);
afterAll(async () => { runtime(); await rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); }, TIMEOUT);

describe("isolated durable trusted fiat evidence journal", () => {
  it.each(["Bank Transfer", "Face-to-Face (Meet in Person)"] as const)("retains %s evidence and exact historical receipts across pause and reopen", async method => {
    const { fixture, store, storeId, dataDir, initialized, prepared, journal } = await fresh(method);
    expect(initialized.checkpoint.revision).toBe(0);
    const input = { operationId: "record_one", prepared }, receipt = await journal.record(input);
    expect(receipt).toMatchObject({ disposition: "recorded", revision: 1, executionAuthority: false, releaseAuthority: false });
    expect(await journal.record(input)).toEqual(receipt);
    await journal.pause({ operationId: "pause_one", reasonCode: "maintenance" });
    const before = await journal.inspect();
    expect(before.records).toHaveLength(2); expect(before.state.payments).toHaveLength(1);
    await store.close();
    const reopened = await createFileWalletStore({ mode: MODE, dataDir }); stores.push(reopened);
    const recovered = createDevelopmentTrustedPaymentJournal({ mode: MODE, store: reopened, storeId, manifest: fixture.manifest, clock: fixture.now });
    expect(await recovered.inspect()).toEqual(before);
    fixture.setNow(fixture.now() + 9_000_000);
    expect(await recovered.record(input)).toEqual(receipt);
    expect(await recovered.lookupReceipt({ operationId: input.operationId, inputHash: receipt.inputHash })).toEqual(receipt);
    await expect(recovered.record({ ...input, operationId: "later" })).rejects.toMatchObject({ code: "STOPPED" });
    expect(await recovered.inspect()).toEqual(before);
  }, TIMEOUT);

  it("retains original admission and physical identity across repeated initialization", async () => {
    const { fixture, store, storeId, initialized } = await fresh();
    expect(await initializeDevelopmentTrustedPaymentJournal({ mode: MODE, store, manifest: fixture.manifest,
      clock: () => fixture.now() + 500 })).toEqual(initialized);
    await expect(initializeDevelopmentTrustedPaymentJournal({ mode: MODE, store, manifest: fixture.manifest,
      sourceStoreId: "another_physical_store", clock: fixture.now })).rejects.toMatchObject({ code: "INTEGRITY" });
    const changed = structuredClone(fixture.manifest); changed.sources[0].validUntilMs++;
    await expect(initializeDevelopmentTrustedPaymentJournal({ mode: MODE, store, manifest: changed,
      sourceStoreId: storeId, clock: fixture.now })).rejects.toMatchObject({ code: "INTEGRITY" });
  }, TIMEOUT);

  it("preserves original and conflict receipts and never reopens operation quarantine", async () => {
    const { prepared, journal } = await fresh();
    const original = await journal.record({ operationId: "same_operation", prepared });
    const conflict = await journal.pause({ operationId: "same_operation", reasonCode: "manual-review" });
    expect(conflict.disposition).toBe("operation-conflict-quarantined");
    expect(await journal.record({ operationId: "same_operation", prepared })).toEqual(original);
    expect(await journal.pause({ operationId: "same_operation", reasonCode: "manual-review" })).toEqual(conflict);
    await expect(journal.pause({ operationId: "another_pause", reasonCode: "maintenance" })).rejects.toMatchObject({ code: "STOPPED" });
    expect((await journal.inspect()).records).toHaveLength(2);
  }, TIMEOUT);

  it("stores the entire source reversal and keeps prior settlement historical", async () => {
    const { fixture, prepared, journal } = await fresh();
    const original = await journal.record({ operationId: "settled", prepared });
    fixture.observation.revision = 2; fixture.observation.status = "reversed";
    fixture.setNow(fixture.now() + 10); fixture.observation.observedAtMs = fixture.now() - 1;
    const reversal = await fixture.reader().prepare(fixture.request);
    const receipt = await journal.record({ operationId: "reversal", prepared: reversal });
    expect(receipt.disposition).toBe("source-reversal-quarantined");
    const current = await journal.inspect();
    expect(current.state.payments[0].revisions.map(row => row.status)).toEqual(["settled", "reversed"]);
    expect(current.records[1].command).toEqual({ type: "record", operationId: "reversal", prepared: reversal });
    expect(await journal.record({ operationId: "settled", prepared })).toEqual(original);
    expect(await journal.record({ operationId: "reversal", prepared: reversal })).toEqual(receipt);
    expect((await journal.inspect()).state.status).toBe("quarantined");
  }, TIMEOUT);

  it("orders two queued writers and retains one original payment attribution", async () => {
    const { prepared, journal } = await fresh();
    const results = await Promise.all([journal.record({ operationId: "first", prepared }), journal.record({ operationId: "second", prepared })]);
    expect(results.map(row => row.disposition)).toEqual(["recorded", "corroborated"]);
    const current = await journal.inspect();
    expect(current.records).toHaveLength(2); expect(current.state.payments).toHaveLength(1);
    expect(current.state.payments[0].revisions).toHaveLength(1);
  }, TIMEOUT);

  it("recovers the exact receipt after a real commit loses its acknowledgement", async () => {
    const { store, prepared, journal, make } = await fresh();
    let committed = false, failure: unknown;
    const lost: WalletStore = { close: async () => undefined, async transaction(work) {
      await store.transaction(work); committed = true; throw new CommitOutcomeUnknownError(new Error("Fixture reply lost after commit"));
    } };
    try { await make(lost).record({ operationId: "lost_reply", prepared }); } catch (error) { failure = error; }
    expect(committed).toBe(true); expect(failure).toBeInstanceOf(CommitOutcomeUnknownError);
    const recovery = (failure as CommitOutcomeUnknownError & { trustedPaymentJournalRecovery: TrustedPaymentJournalUnknownCommand }).trustedPaymentJournalRecovery;
    expect(Object.isFrozen(recovery)).toBe(true);
    expect(await journal.reconcileUnknown(recovery)).toMatchObject({ status: "committed", receipt: { operationId: "lost_reply", revision: 1 } });
    expect((await journal.inspect()).records).toHaveLength(1);
  }, TIMEOUT);

  it.each(["missing", "substituted", "getter"] as const)("separates acknowledged %s response loss from a failed database commit", async kind => {
    const { store, prepared, journal, make } = await fresh(); let getters = 0, failure: unknown;
    const adapter: WalletStore = { close: async () => undefined, async transaction(work) {
      const original = await store.transaction(work); void original;
      if (kind === "missing") return undefined as typeof original;
      if (kind === "substituted") return { revision: 99 } as typeof original;
      return Object.defineProperty({}, "revision", { enumerable: true, get() { getters++; return 1; } }) as typeof original;
    } };
    try { await make(adapter).record({ operationId: "response_loss", prepared }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(TrustedPaymentJournalCommittedResponseUnavailableError); expect(getters).toBe(0);
    expect(await journal.reconcileUnknown((failure as TrustedPaymentJournalCommittedResponseUnavailableError).trustedPaymentJournalRecovery))
      .toMatchObject({ status: "committed", receipt: { operationId: "response_loss", revision: 1 } });
  }, TIMEOUT);

  it.each(["inspect", "lookup", "reconcile", "export"] as const)("does not trust a substituted %s result outside its certified participant", async kind => {
    const { store, storeId, initialized, prepared, journal, make } = await fresh(); let getters = 0;
    const receipt = await journal.record({ operationId: "original", prepared });
    await journal.pause({ operationId: "paused", reasonCode: "maintenance" });
    const adapter: WalletStore = { close: async () => undefined, async transaction(work) {
      const actual = await store.transaction(work); void actual;
      return Object.defineProperty({}, "status", { enumerable: true, get() { getters++; return "not-recorded"; } }) as typeof actual;
    } };
    const altered = make(adapter);
    if (kind === "reconcile") {
      expect(await altered.reconcileUnknown({ operationId: receipt.operationId, inputHash: receipt.inputHash,
        expectedStoreId: storeId, expectedPreCommandCheckpoint: initialized.checkpoint })).toMatchObject({
        status: "unresolved", receipt: null, archive: null, executionAuthority: false, releaseAuthority: false });
    } else {
      const action = kind === "inspect" ? () => altered.inspect() : kind === "lookup"
        ? () => altered.lookupReceipt({ operationId: receipt.operationId, inputHash: receipt.inputHash }) : () => altered.exportBackup();
      await expect(action()).rejects.toMatchObject({ code: "INTEGRITY" });
    }
    expect(getters).toBe(0); expect((await journal.inspect()).checkpoint.revision).toBe(2);
  }, TIMEOUT);

  it("limits absence conclusions to the original physical target and a retained checkpoint", async () => {
    const { storeId, initialized, prepared, journal } = await fresh();
    const query = { operationId: "absent", inputHash: "a".repeat(64), expectedStoreId: storeId, expectedPreCommandCheckpoint: initialized.checkpoint };
    expect((await journal.reconcileUnknown(query)).status).toBe("not-recorded");
    await journal.record({ operationId: "some_record", prepared });
    expect((await journal.reconcileUnknown(query)).status).toBe("not-recorded-stale");
    expect((await journal.reconcileUnknown({ ...query, expectedStoreId: "different" })).status).toBe("unresolved");
    expect((await journal.reconcileUnknown({ ...query, expectedPreCommandCheckpoint: { ...initialized.checkpoint, stateHash: "b".repeat(64) } })).status).toBe("unresolved");
  }, TIMEOUT);

  it.each(["command", "head", "seal"] as const)("rolls back all evidence after an actual SQL failure at %s", async point => {
    const { store, prepared, journal, make, initialized } = await fresh();
    let injected = false;
    const faulty = wrapped(store, tx => ({
      async query<T extends Row>(sql: string, params?: unknown[]) {
        const result = await tx.query<T>(sql, params);
        if ((point === "command" && sql.startsWith(`INSERT INTO ${SCHEMA}.commands`))
          || (point === "head" && sql.startsWith(`UPDATE ${SCHEMA}.head SET archive_json`))) {
          injected = true; await tx.query("SELECT 1/0 /* fixture rollback */");
        }
        return result;
      },
      async exec(sql: string) {
        if (point === "seal" && sql === "SET CONSTRAINTS ALL IMMEDIATE") { injected = true; await tx.query("SELECT 1/0 /* fixture deferred failure */"); }
        await tx.exec(sql);
      },
    }));
    await expect(make(faulty).record({ operationId: "failed", prepared })).rejects.toBeDefined();
    expect(injected).toBe(true); expect(await journal.inspect()).toEqual(initialized);
  }, TIMEOUT);

  it("poisons its original physical owner when invalid inert input is caught by a caller", async () => {
    const { store, prepared, make, journal, initialized } = await fresh(); let caught = false, getters = 0;
    await expect(store.transaction(async tx => {
      const payload = Object.defineProperty({ operationId: "invalid" }, "prepared", { enumerable: true, get() { getters++; return prepared; } });
      try { await make(bound(tx)).record(payload as { operationId: string; prepared: typeof prepared }); } catch { caught = true; }
      await tx.query("SELECT 1 AS companion");
    })).rejects.toBeDefined();
    expect(caught).toBe(true); expect(getters).toBe(0); expect(await journal.inspect()).toEqual(initialized);
  }, TIMEOUT);

  it("refuses non-UTC sessions and poisons the same physical owner even if its refusal is swallowed", async () => {
    const { store, make, journal, initialized } = await fresh(); let caught = false;
    await expect(store.transaction(async tx => {
      await tx.query("SET LOCAL TIME ZONE 'Europe/Bucharest'");
      try { await make(bound(tx)).inspect(); } catch { caught = true; }
      await tx.query("SET LOCAL TIME ZONE 'UTC'");
    })).rejects.toBeDefined();
    expect(caught).toBe(true); expect(await journal.inspect()).toEqual(initialized);
  }, TIMEOUT);

  it.each(["UPDATE", "DELETE", "TRUNCATE"] as const)("refuses direct %s of immutable records", async operation => {
    const { store, prepared, journal } = await fresh();
    await journal.record({ operationId: "retained", prepared });
    const before = await journal.inspect();
    const sql = operation === "UPDATE" ? `UPDATE ${SCHEMA}.commands SET operation_id='rewritten'`
      : operation === "DELETE" ? `DELETE FROM ${SCHEMA}.commands` : `TRUNCATE ${SCHEMA}.commands`;
    await expect(store.transaction(tx => tx.exec(sql))).rejects.toBeDefined();
    expect(await journal.inspect()).toEqual(before);
  }, TIMEOUT);

  it("refuses a forged advanced head without the complete immutable command", async () => {
    const { store, initialized, journal } = await fresh();
    await expect(store.transaction(async tx => {
      await tx.query(`UPDATE ${SCHEMA}.head SET lock_version=lock_version+1,owner_transaction_id=txid_current()::text WHERE singleton`);
      await tx.query(`UPDATE ${SCHEMA}.head SET revision=1,archive_json=jsonb_set(archive_json,'{checkpoint,revision}','1') WHERE singleton`);
      await tx.exec("SET CONSTRAINTS ALL IMMEDIATE");
    })).rejects.toBeDefined();
    expect(await journal.inspect()).toEqual(initialized);
  }, TIMEOUT);

  it.each(["paused", "quarantined"] as const)("SQL guards independently refuse hash-consistent append and reset after %s", async status => {
    const { store, prepared, journal } = await fresh();
    await journal.record({ operationId: "original", prepared });
    await journal.pause({ operationId: status === "quarantined" ? "original" : "paused", reasonCode: "maintenance" });
    const before = await journal.inspect(), after = forgedAppend(before, { type: "record", operationId: "forged_next", prepared });
    let inserted = false, reset = false;
    await expect(store.transaction(tx => insertDirect(tx, after, () => { inserted = true; }))).rejects.toBeDefined();
    expect(inserted).toBe(false);
    await expect(store.transaction(async tx => {
      await tx.query(`UPDATE ${SCHEMA}.head SET lock_version=lock_version+1,owner_transaction_id=txid_current()::text WHERE singleton`);
      await tx.query(`UPDATE ${SCHEMA}.head SET archive_json=$1::jsonb,revision=$2,event_hash=$3,state_hash=$4,archive_sha256=$5 WHERE singleton`,
        [JSON.stringify(after), after.checkpoint.revision, after.checkpoint.eventHash, after.checkpoint.stateHash, after.archiveSha256]);
      reset = true; await tx.query("SELECT 1/0 /* roll back an unexpectedly accepted direct head reset */");
    })).rejects.toBeDefined();
    expect(reset).toBe(false); expect(await journal.inspect()).toEqual(before);
  }, TIMEOUT);

  it("SQL rejects a hash-consistent JSON-null status in both receipt and projection", async () => {
    const { store, prepared, initialized, journal } = await fresh();
    const after = forgedAppend(initialized, { type: "record", operationId: "null_status", prepared }, null);
    let inserted = false;
    await expect(store.transaction(tx => insertDirect(tx, after, () => { inserted = true; }))).rejects.toBeDefined();
    expect(inserted).toBe(false); expect(await journal.inspect()).toEqual(initialized);
  }, TIMEOUT);

  it("refuses companion namespaces and rolls back a caught participant refusal", async () => {
    const { store, make, journal, initialized } = await fresh(); let caught = false;
    await expect(store.transaction(async tx => {
      await tx.exec("CREATE SCHEMA alpha_wallet_simulation");
      try { await make(bound(tx)).inspect(); } catch { caught = true; }
      await tx.exec("CREATE SCHEMA after_caught_refusal");
    })).rejects.toBeDefined();
    expect(caught).toBe(true); expect(await journal.inspect()).toEqual(initialized);
  }, TIMEOUT);

  it("detects changed schema guards and refuses to commit the caller's alteration", async () => {
    const { store, make, journal, initialized } = await fresh(); let caught = false;
    await expect(store.transaction(async tx => {
      await tx.exec(`ALTER TABLE ${SCHEMA}.commands DISABLE TRIGGER guard_command`);
      try { await make(bound(tx)).inspect(); } catch { caught = true; }
      await tx.query("SELECT 1");
    })).rejects.toBeDefined();
    expect(caught).toBe(true); expect(await journal.inspect()).toEqual(initialized);
  }, TIMEOUT);

  it("refuses active export and restores a stopped source as one complete permanently quarantined target", async () => {
    const { storeId, fixture, prepared, journal } = await fresh();
    const sourceReceipt = await journal.record({ operationId: "source_record", prepared });
    await expect(journal.exportBackup()).rejects.toMatchObject({ code: "STOPPED" });
    await journal.pause({ operationId: "source_pause", reasonCode: "maintenance" });
    const backup = await journal.exportBackup(), target = await empty();
    const restored = await restoreDevelopmentTrustedPaymentJournal({ mode: MODE, store: target.store, backup,
      expectedChecksum: backup.backupSha256, operationId: "restore_once", targetStoreId: target.storeId,
      acknowledgeFreshTarget: true, clock: fixture.now });
    expect(restored.archive.records.slice(0, -1)).toEqual(backup.archive.records);
    expect(restored.archive.bootstrap.sourceStoreId).toBe(storeId);
    expect(restored.archive.state).toMatchObject({ status: "quarantined", restoredTargetStoreId: target.storeId, haltReason: "restored-copy" });
    const targetJournal = createDevelopmentTrustedPaymentJournal({ mode: MODE, store: target.store,
      storeId: target.storeId, manifest: fixture.manifest, clock: fixture.now });
    expect(await targetJournal.lookupReceipt({ operationId: "source_record", inputHash: sourceReceipt.inputHash })).toEqual(sourceReceipt);
    expect(await targetJournal.record({ operationId: "source_record", prepared })).toEqual(sourceReceipt);
    await expect(targetJournal.record({ operationId: "cannot_resume", prepared })).rejects.toMatchObject({ code: "STOPPED" });
    await expect(targetJournal.exportBackup()).rejects.toMatchObject({ code: "STOPPED" });
    expect((await targetJournal.reconcileUnknown({ operationId: "absent_source_command", inputHash: "a".repeat(64),
      expectedStoreId: target.storeId, expectedPreCommandCheckpoint: backup.archive.checkpoint })).status).toBe("unresolved");
    await expect(restoreDevelopmentTrustedPaymentJournal({ mode: MODE, store: target.store, backup,
      expectedChecksum: backup.backupSha256, operationId: "restore_again", targetStoreId: target.storeId,
      acknowledgeFreshTarget: true, clock: fixture.now })).rejects.toMatchObject({ code: "INTEGRITY" });
    expect(await journal.inspect()).toEqual(backup.archive);
  }, TIMEOUT);

  it("rejects a mismatched independently retained checksum without installing any schema", async () => {
    const { fixture, journal } = await fresh(); await journal.pause({ operationId: "paused", reasonCode: "maintenance" });
    const backup = await journal.exportBackup(), target = await empty();
    await expect(restoreDevelopmentTrustedPaymentJournal({ mode: MODE, store: target.store, backup, expectedChecksum: "f".repeat(64),
      operationId: "restore", targetStoreId: target.storeId, acknowledgeFreshTarget: true, clock: fixture.now })).rejects.toMatchObject({ code: "INTEGRITY" });
    expect(await noSchema(target.store)).toEqual([]);
  }, TIMEOUT);

  it.each(["schema", "head", "command", "seal"] as const)("rolls back fresh restoration completely after SQL failure at %s", async point => {
    const { fixture, prepared, journal } = await fresh();
    await journal.record({ operationId: "record", prepared }); await journal.pause({ operationId: "paused", reasonCode: "maintenance" });
    const backup = await journal.exportBackup(), target = await empty(); let injected = false;
    const faulty = wrapped(target.store, tx => ({
      async query<T extends Row>(sql: string, params?: unknown[]) {
        const result = await tx.query<T>(sql, params);
        if ((point === "head" && sql.startsWith(`INSERT INTO ${SCHEMA}.head`))
          || (point === "command" && sql.startsWith(`INSERT INTO ${SCHEMA}.commands`))) {
          injected = true; await tx.query("SELECT 1/0 /* restoration rollback */");
        }
        return result;
      },
      async exec(sql: string) {
        await tx.exec(sql);
        if ((point === "schema" && sql.includes(`CREATE SCHEMA ${SCHEMA}`))
          || (point === "seal" && sql === "SET CONSTRAINTS ALL IMMEDIATE")) {
          injected = true; await tx.query("SELECT 1/0 /* restoration rollback */");
        }
      },
    }));
    await expect(restoreDevelopmentTrustedPaymentJournal({ mode: MODE, store: faulty, backup, expectedChecksum: backup.backupSha256,
      operationId: "restore", targetStoreId: target.storeId, acknowledgeFreshTarget: true, clock: fixture.now })).rejects.toBeDefined();
    expect(injected).toBe(true); expect(await noSchema(target.store)).toEqual([]);
  }, TIMEOUT);

  it("recovers an actual committed restore after losing its response on that exact target", async () => {
    const { fixture, journal } = await fresh(); await journal.pause({ operationId: "paused", reasonCode: "maintenance" });
    const backup = await journal.exportBackup(), target = await empty(); let failure: unknown;
    const lost: WalletStore = { close: async () => undefined, async transaction(work) {
      await target.store.transaction(work); throw new CommitOutcomeUnknownError(new Error("Restore committed; reply unavailable"));
    } };
    try { await restoreDevelopmentTrustedPaymentJournal({ mode: MODE, store: lost, backup, expectedChecksum: backup.backupSha256,
      operationId: "restore", targetStoreId: target.storeId, acknowledgeFreshTarget: true, clock: fixture.now }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(CommitOutcomeUnknownError);
    const recovered = createDevelopmentTrustedPaymentJournal({ mode: MODE, store: target.store,
      storeId: target.storeId, manifest: fixture.manifest, clock: fixture.now });
    const metadata = (failure as CommitOutcomeUnknownError & { trustedPaymentJournalRecovery: TrustedPaymentJournalUnknownCommand }).trustedPaymentJournalRecovery;
    expect(await recovered.reconcileUnknown(metadata)).toMatchObject({ status: "committed", receipt: { disposition: "restored-quarantined" } });
    expect((await recovered.inspect()).records).toHaveLength(backup.archive.records.length + 1);
  }, TIMEOUT);

  it("SQL wallet digests match the JSON commitment contract including Unicode and numeric property keys", async () => {
    const { store } = await fresh();
    const value = { "10": "ten", "2": "two", "0": "zero", "4294967295": "non-index", z: "\u000b\n\t", "💶": "șé\u2028", a: [1, true, null] };
    const row = await store.transaction(async tx => (await tx.query<{ digest: string }>(`SELECT ${SCHEMA}.value_digest($1::jsonb) AS digest`, [JSON.stringify(value)])).rows[0]);
    expect(row.digest).toBe(walletDigest(value));
  }, TIMEOUT);
});
