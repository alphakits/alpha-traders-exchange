// @vitest-environment node
// Real disposable SQL stores exercise the complete export/restore boundary.
// Pure envelope corruption coverage lives alongside the manifest codec.
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  marketplaceBackupFixture, MARKETPLACE_BACKUP_RESTORE_TIME,
} from "../../../scripts/alpha-wallet/marketplace-backup-fixtures";
import { FIXTURE_TIME, OPERATOR, TRON } from "../../../scripts/alpha-wallet/durable-fixtures";
import { parseUnits } from "./amounts";
import { walletDigest } from "./commands";
import { initializeDurableWallet } from "./durable";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import type { FileFakeProvider } from "./fake-provider";
import { assertLedgerInvariants, balance, expectedCustody } from "./ledger";
import {
  exportMarketplaceWalletBackup, inspectMarketplaceWalletBackup, inspectRestoredMarketplaceWallet,
  restoreMarketplaceWalletBackup,
} from "./marketplace-backup";
import { createDevelopmentMarketplaceWalletCoordinator } from "./marketplace-coordinator";
import { v2Command, versionedCommandKey } from "./v2-commands";
import { exportVersionedWalletBackup } from "./versioned-backup";
import { createVersionedDurableWallet, verifyVersionedHistory } from "./versioned-durable";
import { createVersionedSimulationPayoutWorker } from "./versioned-payout-worker";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));

const MODE = "simulation-only" as const;
const TIMEOUT = 120_000;
const RESTORE_AT = MARKETPLACE_BACKUP_RESTORE_TIME;
const stores: WalletStore[] = [];
let directory: string;
let accepted: Awaited<ReturnType<typeof retainedBackup>>;

const COMMANDS = `SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
  command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
  FROM alpha_wallet_simulation.commands ORDER BY revision`;
const CANONICAL_TABLES = [
  ["runtime_meta", "singleton"], ["purchase_requests", "id"], ["listings", "id"], ["commissions", "id"],
  ["trust_snapshots", "seller_id"], ["evidence", "id"], ["disputes", "id"], ["notifications", "id"],
  ["audit_logs", "id"], ["activity_logs", "id"], ["trades", "id"],
] as const;
const COORDINATION_TABLES = [
  ["enrollments", "request_id"], ["acceptances", "acceptance_key"], ["publications", "id"],
] as const;

function guardedRuntime() {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) {
    vi.stubEnv(key, undefined);
  }
}

beforeAll(async () => {
  guardedRuntime();
  const sourceDirectory = await mkdtemp(join(tmpdir(), "alpha-wallet-marketplace-backup-source-"));
  const store = await createFileWalletStore({ mode: MODE, dataDir: sourceDirectory });
  try { accepted = await retainedBackup(store); }
  finally {
    try { await store.close(); }
    finally { await rm(sourceDirectory, { recursive: true, force: true }); vi.unstubAllEnvs(); }
  }
}, TIMEOUT);

beforeEach(async () => {
  guardedRuntime();
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-marketplace-backup-test-"));
});

afterEach(async () => {
  try {
    const outcomes = await Promise.allSettled(stores.splice(0).map(store => store.close()));
    for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
  } finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { vi.unstubAllEnvs(); }
  }
}, TIMEOUT);

async function connected(name: string) {
  const dataDir = join(directory, name);
  const store = await createFileWalletStore({ mode: MODE, dataDir });
  stores.push(store);
  return { store, dataDir };
}

function bound(backing: WalletStore, make: (tx: WalletSql) => WalletSql): WalletStore {
  return { transaction: work => backing.transaction(tx => work(make(tx))), close: async () => undefined };
}

async function financialRows(store: WalletStore) {
  return store.transaction(async tx => {
    const canonical: Record<string, unknown[]> = {};
    const coordination: Record<string, unknown[]> = {};
    for (const [table, order] of CANONICAL_TABLES) {
      // Fixed test-owned identifiers only. JSON preserves SQL timestamp precision;
      // the bigint runtime counter is stringified before crossing into JavaScript.
      const expression = table === "runtime_meta"
        ? "jsonb_set(to_jsonb(r),'{version}',to_jsonb(r.version::text))" : "to_jsonb(r)";
      canonical[table] = (await tx.query<{ row: unknown }>(`SELECT ${expression} AS row FROM alpha_exchange.${table} r ORDER BY ${order}`)).rows.map(row => row.row);
    }
    for (const [table, order] of COORDINATION_TABLES) {
      coordination[table] = (await tx.query<{ row: unknown }>(`SELECT to_jsonb(r) AS row FROM alpha_wallet_marketplace_simulation.${table} r ORDER BY ${order}`)).rows.map(row => row.row);
    }
    return { canonical, coordination, commands: (await tx.query(COMMANDS)).rows };
  });
}

async function targetFootprint(store: WalletStore) {
  return store.transaction(async tx => ({
    schemas: (await tx.query(`SELECT nspname FROM pg_namespace
      WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%' ORDER BY nspname`)).rows,
    relations: (await tx.query(`SELECT n.nspname,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' OR n.nspname NOT IN ('pg_catalog','information_schema','public') AND n.nspname NOT LIKE 'pg_%'
      ORDER BY n.nspname,c.relname,c.relkind`)).rows,
    functions: (await tx.query(`SELECT n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' OR n.nspname NOT IN ('pg_catalog','information_schema','public') AND n.nspname NOT LIKE 'pg_%'
      ORDER BY n.nspname,p.proname`)).rows,
  }));
}

async function retainedBackup(store: WalletStore, options: Parameters<typeof marketplaceBackupFixture>[1] = {}) {
  const source = await marketplaceBackupFixture(store, options);
  const before = await financialRows(store);
  const serialized = await exportMarketplaceWalletBackup({ mode: MODE, store, ...source.ownerInput, clock: source.clock });
  const inspection = inspectMarketplaceWalletBackup(serialized);
  expect(await financialRows(store)).toEqual(before);
  return { serialized, inspection, original: before, source };
}

function restore(store: WalletStore, serialized = accepted.serialized, at = RESTORE_AT) {
  return restoreMarketplaceWalletBackup({
    mode: MODE, store, backup: serialized, acknowledgeFreshTarget: true,
    expectedChecksum: inspectMarketplaceWalletBackup(serialized).checksum, clock: () => at,
  });
}

function recovered(store: WalletStore, checksum = accepted.inspection.checksum) {
  return inspectRestoredMarketplaceWallet({ mode: MODE, store, expectedChecksum: checksum });
}

function quarantineKey(checksum: string) {
  return versionedCommandKey(v2Command("pause", { kind: "operator", id: "marketplace-backup-recovery" }, `restore-${checksum}`, null));
}

function expectSafeMetadata(value: unknown, fixture = accepted.source.fixture) {
  const serialized = JSON.stringify(value);
  for (const token of [fixture.ownerSessionToken, fixture.buyerSessionToken, fixture.sellerSessionToken]) {
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(createHash("sha256").update(token).digest("hex"));
  }
  for (const secret of ["accountNumber", "accountHolderName", "sellerBankAccountSnapshot", "Synthetic fixture bank", "0000000000",
    "paymentInstructionsDigest", "destination", "sim://", "passwordHash", "token_hash", "verifiedPhone", "@example.invalid"]) {
    expect(serialized).not.toContain(secret);
  }
}

function resign(document: Record<string, unknown>) {
  const body = { ...document };
  delete body.checksum;
  return JSON.stringify({ ...body, checksum: walletDigest(body) });
}

describe("combined marketplace and wallet recovery", () => {
  it("restores all financial rows and original history atomically, adding a distinct pause before a verified reopen", async () => {
    const target = await connected("complete-restore");
    let transactions = 0;
    const counted: WalletStore = { transaction: work => { transactions++; return target.store.transaction(work); }, close: async () => undefined };
    const result = await restore(counted);
    expect(transactions).toBe(1);
    expect(result).toMatchObject({ backup: accepted.inspection, quarantined: true,
      quarantineCommandKey: quarantineKey(accepted.inspection.checksum),
      restored: { revision: accepted.inspection.checkpoint.revision + 1, lastCommandAtMs: RESTORE_AT } });
    expectSafeMetadata(result);
    const current = await financialRows(target.store);
    expect(current.canonical).toEqual(accepted.original.canonical);
    expect(current.coordination).toEqual(accepted.original.coordination);
    expect(current.commands.slice(0, -1)).toEqual(accepted.original.commands);
    expect(current.commands.at(-1)).toMatchObject({
      revision: accepted.inspection.checkpoint.revision + 1, command_type: "pause",
      command_key: result.quarantineCommandKey, occurred_at_ms: String(RESTORE_AT),
      command_json: { actor: { kind: "operator", id: "marketplace-backup-recovery" } },
    });
    const replayed = verifyVersionedHistory(current.commands);
    expect(replayed.state.haltReason).toBe("Operator emergency pause");
    expect(walletDigest(replayed.state)).toBe(result.restored.stateHash);
    expect(replayed.eventHash).toBe(result.restored.eventHash);
    expect(balance(replayed.state, TRON, `trade:${accepted.source.fixture.tradeId}`)).toBe(parseUnits("300", 6));
    expect(balance(replayed.state, TRON, `listing:${accepted.source.fixture.listingId}`)).toBe(parseUnits("200", 6));
    expect(expectedCustody(replayed.state, TRON)).toBe(parseUnits("500", 6));
    assertLedgerInvariants(replayed.state);
    await target.store.close();
    const reopened = await connected("complete-restore");
    const inspected = await recovered(reopened.store);
    expect(inspected).toMatchObject({ checksum: accepted.inspection.checksum, source: accepted.inspection.checkpoint,
      restored: result.restored, requestId: accepted.source.fixture.requestId, ownerId: accepted.source.fixture.ownerId,
      restoredAtMs: RESTORE_AT, quarantineCommandKey: result.quarantineCommandKey, quarantined: true });
    expectSafeMetadata(inspected);
    expect(await financialRows(reopened.store)).toEqual(current);
  }, TIMEOUT);

  it("preserves a pending enrollment and face-to-face terms without manufacturing an acceptance", async () => {
    const source = await connected("pending-face-to-face-source");
    const pending = await retainedBackup(source.store, { paymentMethod: "Face-to-Face", acceptCorrection: false });
    const target = await connected("pending-face-to-face-target");
    await restore(target.store, pending.serialized);
    const rows = await financialRows(target.store);
    expect(rows.canonical).toEqual(pending.original.canonical);
    expect(rows.coordination).toEqual(pending.original.coordination);
    expect(rows.coordination.acceptances).toHaveLength(0);
    expect(rows.coordination.publications).toHaveLength(0);
    const replayed = verifyVersionedHistory(rows.commands);
    expect(balance(replayed.state, TRON, `trade:${pending.source.fixture.tradeId}`)).toBe(parseUnits("200", 6));
    expect(balance(replayed.state, TRON, `listing:${pending.source.fixture.listingId}`)).toBe(parseUnits("300", 6));
    expect((await recovered(target.store, pending.inspection.checksum)).quarantined).toBe(true);
  }, TIMEOUT);

  it("exports no login credentials and creates disabled identity stubs with no copied sessions", async () => {
    const document = JSON.parse(accepted.serialized) as { canonical: Record<string, unknown>; coordination: Record<string, unknown> };
    expect(document.canonical.sessions).toBeUndefined();
    expect(document.coordination.transaction_contexts).toBeUndefined();
    for (const user of document.canonical.users as Record<string, unknown>[]) {
      expect(Object.keys(user).sort()).toEqual(["id", "role", "seller_status"]);
    }
    for (const token of [accepted.source.fixture.ownerSessionToken, accepted.source.fixture.buyerSessionToken, accepted.source.fixture.sellerSessionToken]) {
      expect(accepted.serialized).not.toContain(token);
      expect(accepted.serialized).not.toContain(createHash("sha256").update(token).digest("hex"));
    }
    for (const field of ["passwordHash", "token_hash", "verifiedPhone", "@example.invalid"]) expect(accepted.serialized).not.toContain(field);
    expectSafeMetadata(accepted.inspection);
    const target = await connected("no-copied-authority");
    await restore(target.store);
    const identities = await target.store.transaction(async tx => ({
      users: (await tx.query<{ id: string; payload: Record<string, unknown> }>("SELECT id,payload FROM alpha_exchange.users ORDER BY id")).rows,
      sessions: (await tx.query("SELECT * FROM alpha_exchange.sessions")).rows,
    }));
    expect(identities.sessions).toEqual([]);
    expect(identities.users.map(user => user.id).sort()).toEqual(accepted.source.fixture.accounts.map(user => user.id).sort());
    for (const user of identities.users) {
      expect(user.payload.disabled).toBe(true);
      expect(user.payload.passwordHash).not.toBe("synthetic-fixture-not-a-login");
      expect(user.payload.verifiedPhone).toBeUndefined();
    }
    const coordinator = createDevelopmentMarketplaceWalletCoordinator({ mode: MODE, store: target.store, clock: () => RESTORE_AT });
    await expect(coordinator.inspect(accepted.source.ownerInput)).rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
    await expect(coordinator.acceptAmountCorrection(accepted.source.acceptanceInput)).rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
    expect((await recovered(target.store)).quarantined).toBe(true);
  }, TIMEOUT);

  it("keeps standalone commands, exports, workers and legacy marketplace writers fenced after recovery", async () => {
    const target = await connected("restored-guards");
    await restore(target.store);
    const before = await financialRows(target.store);
    const wallet = createVersionedDurableWallet({ mode: MODE, store: target.store, clock: () => RESTORE_AT });
    await expect(wallet.snapshot()).rejects.toThrow();
    await expect(wallet.recoverPayouts()).rejects.toThrow();
    await expect(wallet.execute(v2Command("pause", OPERATOR, "standalone-pause-bypass", null))).rejects.toThrow();
    await expect(exportVersionedWalletBackup({ mode: MODE, store: target.store, clock: () => RESTORE_AT })).rejects.toThrow();
    const provider: FileFakeProvider = {
      kind: "alpha-wallet-file-fake-provider",
      lookup: vi.fn(async () => { throw new Error("No recovery provider lookup is authorized"); }),
      submit: vi.fn(async () => { throw new Error("No recovery provider submission is authorized"); }),
      finalize: vi.fn(async () => { throw new Error("No recovery provider finalization is authorized"); }),
    };
    const worker = createVersionedSimulationPayoutWorker({ mode: MODE, wallet, provider });
    await expect(worker.step("unavailable-payout")).rejects.toThrow();
    expect(provider.lookup).not.toHaveBeenCalled(); expect(provider.submit).not.toHaveBeenCalled(); expect(provider.finalize).not.toHaveBeenCalled();
    await expect(target.store.transaction(tx => tx.query(
      "UPDATE alpha_exchange.purchase_requests SET payload=jsonb_set(payload,'{usdtAmount}','\"999\"') WHERE id=$1",
      [accepted.source.fixture.requestId],
    ))).rejects.toThrow();
    await expect(target.store.transaction(tx => tx.query("DELETE FROM alpha_exchange.notifications"))).rejects.toThrow();
    await expect(target.store.transaction(tx => tx.exec("TRUNCATE alpha_wallet_marketplace_simulation.publications"))).rejects.toThrow();
    expect(await financialRows(target.store)).toEqual(before);
    expect((await recovered(target.store)).quarantined).toBe(true);
  }, TIMEOUT);

  it.each([
    ["an initialized empty wallet", async (store: WalletStore) => { await initializeDurableWallet(store); }],
    ["an empty canonical schema", async (store: WalletStore) => { await store.transaction(tx => tx.exec("CREATE SCHEMA alpha_exchange")); }],
    ["an empty coordination schema", async (store: WalletStore) => { await store.transaction(tx => tx.exec("CREATE SCHEMA alpha_wallet_marketplace_simulation")); }],
    ["an unrelated empty schema", async (store: WalletStore) => { await store.transaction(tx => tx.exec("CREATE SCHEMA retained_application")); }],
    ["a public data table", async (store: WalletStore) => { await store.transaction(tx => tx.exec("CREATE TABLE public.keep_me(value text); INSERT INTO public.keep_me VALUES ('retained')")); }],
    ["a public function", async (store: WalletStore) => { await store.transaction(tx => tx.exec("CREATE FUNCTION public.keep_me() RETURNS text LANGUAGE sql AS $$ SELECT 'retained'::text $$")); }],
  ] as const)("refuses %s without deleting or replacing existing objects", async (_name, arrange) => {
    const target = await connected("nonempty-target");
    await arrange(target.store);
    const before = await targetFootprint(target.store);
    await expect(restore(target.store)).rejects.toThrow();
    expect(await targetFootprint(target.store)).toEqual(before);
  }, TIMEOUT);

  it.each(["quarantine", "canonical", "receipt"] as const)(
    "rolls back all schemas and history when a real SQL failure occurs at the %s stage", async stage => {
      const target = await connected(`rollback-${stage}`);
      const before = await targetFootprint(target.store);
      let insertedCommands = 0, faultReached = false;
      const faulted = bound(target.store, tx => ({
        exec: sql => tx.exec(sql),
        async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
          const isCommand = /^\s*INSERT\s+INTO\s+alpha_wallet_simulation\.commands\b/i.test(sql);
          const fail = stage === "quarantine" && isCommand && params?.[1] === quarantineKey(accepted.inspection.checksum)
            || stage === "canonical" && /INSERT\s+INTO\s+alpha_exchange\."?purchase_requests\b/i.test(sql)
            || stage === "receipt" && /UPDATE\s+alpha_wallet_marketplace_simulation\."?recovery_receipts\b/i.test(sql);
          if (fail) { faultReached = true; await tx.query("SELECT 1 / 0"); }
          const result = await tx.query<Row>(sql, params);
          if (isCommand) insertedCommands++;
          return result;
        },
      }));
      await expect(restore(faulted)).rejects.toThrow();
      expect(faultReached).toBe(true);
      expect(insertedCommands).toBe(accepted.inspection.commandCount + (stage === "quarantine" ? 0 : 1));
      expect(await targetFootprint(target.store)).toEqual(before);
      // A known rollback leaves the same, still-empty target usable.
      expect((await restore(target.store)).quarantined).toBe(true);
    }, TIMEOUT,
  );

  it("refuses COMMIT when receipt completion is omitted even if an inner caller reports success", async () => {
    const target = await connected("omitted-recovery-seal");
    const before = await targetFootprint(target.store);
    let skippedSeal = false, workReturned = false;
    const omitted: WalletStore = {
      transaction: work => target.store.transaction(async tx => {
        const result = await work({
          exec: sql => tx.exec(sql),
          async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
            if (/UPDATE\s+alpha_wallet_marketplace_simulation\.recovery_receipts\b/i.test(sql)) {
              skippedSeal = true;
              return { rows: [{ singleton: true }] as unknown as Row[] };
            }
            return tx.query<Row>(sql, params);
          },
        });
        workReturned = true;
        return result;
      }),
      close: async () => undefined,
    };
    await expect(restore(omitted)).rejects.toThrow();
    expect(skippedSeal).toBe(true);
    expect(workReturned).toBe(true);
    expect(await targetFootprint(target.store)).toEqual(before);
  }, TIMEOUT);

  it("recovers a committed restore after an injected lost reply without replaying or overwriting the target", async () => {
    const target = await connected("lost-restore-response");
    let committed = 0;
    const lostReply: WalletStore = {
      async transaction(work) {
        await target.store.transaction(work);
        committed++;
        throw new CommitOutcomeUnknownError(new Error(`Synthetic lost reply containing private marker ${accepted.source.fixture.ownerSessionToken}`));
      },
      close: async () => undefined,
    };
    let failure: unknown;
    try { await restore(lostReply); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN" });
    expect(String((failure as Error)?.cause)).not.toContain(accepted.source.fixture.ownerSessionToken);
    expect(committed).toBe(1);
    await target.store.close();
    const reopened = await connected("lost-restore-response");
    const status = await recovered(reopened.store);
    expect(status).toMatchObject({ checksum: accepted.inspection.checksum, source: accepted.inspection.checkpoint,
      restored: { revision: accepted.inspection.checkpoint.revision + 1 }, quarantined: true });
    expectSafeMetadata(status);
    const before = await financialRows(reopened.store);
    expect(before.commands.slice(0, -1)).toEqual(accepted.original.commands);
    await expect(restore(reopened.store)).rejects.toThrow();
    expect(await financialRows(reopened.store)).toEqual(before);
    expect(await recovered(reopened.store)).toEqual(status);
  }, TIMEOUT);

  it("rejects a recomputed but inconsistent combined manifest before opening a target transaction", async () => {
    const untouched: WalletStore = { transaction: vi.fn(async () => { throw new Error("Invalid backup must not access a target"); }), close: async () => undefined };
    const mutations: ((document: Record<string, unknown>) => void)[] = [
      document => {
        const canonical = document.canonical as { purchase_requests: { id: string; payload: { usdtAmount: string } }[] };
        canonical.purchase_requests.find(row => row.id === accepted.source.fixture.requestId)!.payload.usdtAmount = "301";
      },
      document => { (document.coordination as { acceptances: unknown[] }).acceptances = []; },
      document => { (document.coordination as { publications: unknown[] }).publications = []; },
      document => { (document.coordination as { enrollments: { input_digest: string }[] }).enrollments[0].input_digest = "f".repeat(64); },
      document => {
        const wallet = document.wallet as Record<string, unknown>;
        (wallet.checkpoint as { stateHash: string }).stateHash = "e".repeat(64);
        const body = { ...wallet };
        delete body.checksum;
        wallet.checksum = walletDigest(body);
      },
    ];
    for (const mutate of mutations) {
      const document = JSON.parse(accepted.serialized) as Record<string, unknown>;
      mutate(document);
      const serialized = resign(document);
      const checksum = (JSON.parse(serialized) as { checksum: string }).checksum;
      await expect(restoreMarketplaceWalletBackup({ mode: MODE, store: untouched, backup: serialized,
        acknowledgeFreshTarget: true, expectedChecksum: checksum, clock: () => RESTORE_AT })).rejects.toThrow();
    }
    expect(untouched.transaction).not.toHaveBeenCalled();
  }, TIMEOUT);

  it("requires a separately supplied checksum, explicit fresh-target acknowledgement and a valid clock before target access", async () => {
    const untouched: WalletStore = { transaction: vi.fn(async () => { throw new Error("Target must not be accessed"); }), close: async () => undefined };
    const input = { mode: MODE, store: untouched, backup: accepted.serialized, acknowledgeFreshTarget: true as const,
      expectedChecksum: accepted.inspection.checksum, clock: () => RESTORE_AT };
    for (const expectedChecksum of [undefined, "", "bad-checksum", "f".repeat(64)]) {
      await expect(restoreMarketplaceWalletBackup({ ...input, expectedChecksum: expectedChecksum as unknown as string })).rejects.toThrow();
    }
    await expect(restoreMarketplaceWalletBackup({ ...input, acknowledgeFreshTarget: false as unknown as true })).rejects.toThrow();
    for (const at of [NaN, -1, FIXTURE_TIME - 1]) {
      await expect(restoreMarketplaceWalletBackup({ ...input, clock: () => at })).rejects.toThrow();
    }
    expect(untouched.transaction).not.toHaveBeenCalled();
    vi.stubEnv("NODE_ENV", "production");
    await expect(restoreMarketplaceWalletBackup(input)).rejects.toThrow();
    await expect(exportMarketplaceWalletBackup({ mode: MODE, store: untouched, ...accepted.source.ownerInput })).rejects.toThrow();
    await expect(inspectRestoredMarketplaceWallet({ mode: MODE, store: untouched, expectedChecksum: accepted.inspection.checksum })).rejects.toThrow();
    expect(() => inspectMarketplaceWalletBackup(accepted.serialized)).toThrow();
    expect(untouched.transaction).not.toHaveBeenCalled();
  }, TIMEOUT);

  it("requires the enrolled source to be durably paused and authenticates its owner within the export transaction", async () => {
    const source = await connected("export-authorization-source");
    const seed = await marketplaceBackupFixture(source.store, { pause: false });
    const exportWith = (sessionToken = seed.fixture.ownerSessionToken) => exportMarketplaceWalletBackup({
      mode: MODE, store: source.store, ...seed.ownerInput, sessionToken, clock: seed.clock,
    });
    const beforePause = await financialRows(source.store);
    await expect(exportWith()).rejects.toThrow();
    expect(await financialRows(source.store)).toEqual(beforePause);
    await seed.coordinator.pause({ ...seed.ownerInput, operationId: "export-requires-source-pause" });
    const paused = await financialRows(source.store);
    for (const token of [seed.fixture.buyerSessionToken, seed.fixture.sellerSessionToken, "d4".repeat(32)]) {
      await expect(exportWith(token)).rejects.toThrow();
    }
    seed.setTime(seed.fixture.sessionsExpireAtMs);
    await expect(exportWith()).rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
    seed.setTime(FIXTURE_TIME + 1000);
    await source.store.transaction(tx => tx.query("UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','true') WHERE id=$1", [seed.fixture.ownerId]));
    await expect(exportWith()).rejects.toMatchObject({ code: "WALLET_ACCOUNT_DISABLED" });
    await source.store.transaction(tx => tx.query("UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','false') WHERE id=$1", [seed.fixture.ownerId]));
    expect(await financialRows(source.store)).toEqual(paused);
    let transactions = 0;
    const counted: WalletStore = { transaction: work => { transactions++; return source.store.transaction(work); }, close: async () => undefined };
    const serialized = await exportMarketplaceWalletBackup({ mode: MODE, store: counted, ...seed.ownerInput, clock: seed.clock });
    expect(transactions).toBe(1);
    expect(inspectMarketplaceWalletBackup(serialized).checkpoint.revision).toBe(paused.commands.length);
    expect(await financialRows(source.store)).toEqual(paused);
    expect((await seed.coordinator.inspect(seed.ownerInput)).wallet.halted).toBe(true);
    expect(await seed.coordinator.acceptAmountCorrection({ ...seed.acceptanceInput, operationId: "source-receipt-after-export" }))
      .toEqual({ ...seed.accepted, replayed: true });
    expect(await financialRows(source.store)).toEqual(paused);
  }, TIMEOUT);

  it("refuses export from an unsupported canonical schema or an inconsistent wallet projection", async () => {
    const source = await connected("unsupported-source");
    const seed = await marketplaceBackupFixture(source.store);
    let intercepted = false;
    const missingProjection = bound(source.store, tx => ({
      exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await tx.query<Row>(sql, params);
        if (/FROM alpha_wallet_simulation\.acceptance_receipts\b/i.test(sql)) { intercepted = true; return { rows: [] as Row[] }; }
        return result;
      },
    }));
    await expect(exportMarketplaceWalletBackup({ mode: MODE, store: missingProjection, ...seed.ownerInput, clock: seed.clock })).rejects.toThrow();
    expect(intercepted).toBe(true);
    await source.store.transaction(tx => tx.exec("CREATE TABLE alpha_exchange.future_financial_rows (id text PRIMARY KEY)"));
    const before = await targetFootprint(source.store);
    await expect(exportMarketplaceWalletBackup({ mode: MODE, store: source.store, ...seed.ownerInput, clock: seed.clock })).rejects.toThrow();
    expect(await targetFootprint(source.store)).toEqual(before);
  }, TIMEOUT);

  it("rejects JSON numeric precision loss during export while preserving the exact source value", async () => {
    const source = await connected("lossless-json-source");
    const seed = await marketplaceBackupFixture(source.store);
    const probeId = "recovery-precision-probe";
    // Construct the value inside PostgreSQL: passing it as a JavaScript number
    // would round it before the recovery boundary could detect the problem.
    await source.store.transaction(tx => tx.query(`INSERT INTO alpha_exchange.activity_logs
      (id,user_id,category,created_at,sort_index,payload)
      VALUES ($1,$2,'trade',$3::timestamptz,0,jsonb_build_object(
        'id',$1::text,'userId',$2::text,'category','trade','createdAt',$3::text,
        'title','Synthetic precision probe','details','Exact recovery fixture value',
        'precisionProbe',9007199254740993::numeric))`, [probeId, seed.fixture.ownerId, seed.fixture.at]));
    const exactValue = () => source.store.transaction(async tx => (await tx.query<{ value: string }>(
      "SELECT payload->>'precisionProbe' AS value FROM alpha_exchange.activity_logs WHERE id=$1", [probeId],
    )).rows);
    expect(await exactValue()).toEqual([{ value: "9007199254740993" }]);
    await expect(exportMarketplaceWalletBackup({ mode: MODE, store: source.store,
      ...seed.ownerInput, clock: seed.clock })).rejects.toThrow(/lossless JSON precision/i);
    expect(await exactValue()).toEqual([{ value: "9007199254740993" }]);
  }, TIMEOUT);

  it("rechecks owner expiry after awaited history capture and returns no backup from the failed transaction", async () => {
    const source = await connected("expiry-during-export");
    const seed = await marketplaceBackupFixture(source.store);
    const before = await financialRows(source.store);
    let historyReads = 0, expiryInjected = false;
    const expiresDuringCapture = bound(source.store, tx => ({
      exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await tx.query<Row>(sql, params);
        if (/FROM alpha_wallet_simulation\.commands\b/i.test(sql) && /ORDER BY revision\b/i.test(sql)) {
          historyReads++;
          if (historyReads === 2) { seed.setTime(seed.fixture.sessionsExpireAtMs); expiryInjected = true; }
        }
        return result;
      },
    }));
    await expect(exportMarketplaceWalletBackup({ mode: MODE, store: expiresDuringCapture,
      ...seed.ownerInput, clock: seed.clock })).rejects.toMatchObject({ code: "WALLET_SESSION_REQUIRED" });
    expect(expiryInjected).toBe(true);
    expect(await financialRows(source.store)).toEqual(before);
  }, TIMEOUT);

  it("does not treat an empty, incomplete, differently identified or modified target as a successful restore", async () => {
    const target = await connected("verify-target");
    await expect(recovered(target.store)).rejects.toThrow();
    await restore(target.store);
    await expect(recovered(target.store, "f".repeat(64))).rejects.toThrow();
    const before = await recovered(target.store);
    await expect(target.store.transaction(tx => tx.exec("DELETE FROM alpha_wallet_marketplace_simulation.recovery_receipts"))).rejects.toThrow();
    expect(await recovered(target.store)).toEqual(before);
    // A privileged fixture mutation cannot silently turn recovered identity
    // stubs back into trusted login authority for the recovery inspector.
    await target.store.transaction(tx => tx.query("UPDATE alpha_exchange.users SET payload=jsonb_set(payload,'{disabled}','false') WHERE id=$1", [accepted.source.fixture.ownerId]));
    await expect(recovered(target.store)).rejects.toThrow();
  }, TIMEOUT);
});
