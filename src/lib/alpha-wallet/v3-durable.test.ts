// @vitest-environment node
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUYER, FIXTURE_TIME, OPERATOR, SELLER, TRON, durableFixture } from "../../../scripts/alpha-wallet/durable-fixtures";
import { walletDigest, walletJson } from "./commands";
import { createDurableWallet, initializeDurableWallet, walletCommand } from "./durable";
import { createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { balance, expectedCustody } from "./ledger";
import { simulatedDestination } from "./sandbox";
import { v2Command, WALLET_V2_ENGINE_VERSION } from "./v2-commands";
import { createVersionedDurableWallet, upgradeDurableWalletV2 } from "./versioned-durable";
import { exportVersionedWalletBackup } from "./versioned-backup";
import { initialInputFromPlan, v3Command, v3CommandKey, WALLET_V3_ENGINE_VERSION, type V3Command, type V3VersionedCommand } from "./v3-commands";
import { createV3DurableWallet, upgradeDurableWalletV3, verifyV3History, type V3WalletSnapshot } from "./v3-durable";
import { applyV3Command, isV3State } from "./v3-engine";
import { createV3InitialAcceptanceFixture } from "./v3-fixtures";
import { v3ProjectionDelta, writeV3Projection, type V3Projection } from "./v3-projections";

const MODE = "simulation-only" as const, TIMEOUT = 120_000;
const LISTING = "durable-v3-listing", TRADE = "durable-v3-trade", REQUEST = "durable-v3-request";
const MIGRATION = readFileSync(new URL("../../../docs/alpha-wallet/durable-v3-migration.sql", import.meta.url), "utf8");
const COMMAND_ROWS = `SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
  command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
  FROM alpha_wallet_simulation.commands ORDER BY revision`;
const OLD_TABLES = ["commands", "journals", "entries", "payout_intents", "payout_events", "chain_event_claims",
  "engine_continuations", "trade_terms_events", "acceptance_receipts"];
const NEW_TABLES = ["initial_engine_continuations", "initial_trade_bindings", "initial_acceptance_receipts"];
let directory: string, dataDir: string, now: number, store: WalletStore;
const clock = () => ++now;
const bound = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });
const checkpoint = (snapshot: V3WalletSnapshot) => ({ revision: snapshot.revision, eventHash: snapshot.eventHash,
  stateHash: walletDigest(snapshot.state), lastCommandAtMs: snapshot.lastCommandAtMs });

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
  now = FIXTURE_TIME;
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-v3-durable-"));
  dataDir = join(directory, "wallet");
  store = await createFileWalletStore({ mode: MODE, dataDir });
}, TIMEOUT);
afterEach(async () => {
  try { await store?.close(); }
  finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { vi.unstubAllEnvs(); }
  }
}, TIMEOUT);

async function rows(target = store) { return target.transaction(async tx => (await tx.query(COMMAND_ROWS)).rows); }
async function footprint() {
  return store.transaction(async tx => {
    const layout = (await tx.query<{ name: string }>(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='alpha_wallet_simulation' AND c.relkind='r' ORDER BY c.relname`)).rows.map(row => row.name);
    const tables: Record<string, unknown> = {};
    for (const name of [...OLD_TABLES, ...NEW_TABLES]) if (layout.includes(name)) {
      tables[name] = (await tx.query(`SELECT to_jsonb(record) AS payload FROM alpha_wallet_simulation.${name} record ORDER BY to_jsonb(record)::text`)).rows;
    }
    return { layout, tables, head: (await tx.query("SELECT revision,last_event_hash,format_version FROM alpha_wallet_simulation.head")).rows };
  });
}
async function seedV2(target = store) {
  await initializeDurableWallet(target);
  const v1 = createDurableWallet({ mode: MODE, store: target, clock });
  await durableFixture(v1).fundedListing("500", LISTING);
  const v2 = createVersionedDurableWallet({ mode: MODE, store: target, clock });
  const before = await v2.snapshot();
  const command = v2Command("continueFromV1", OPERATOR, "durable-v3-original-continuation", { checkpoint: checkpoint(before) });
  await upgradeDurableWalletV2({ mode: MODE, store: target, command, acknowledgeVersionUpgrade: true, clock });
  return { v1, v2, snapshot: await v2.snapshot() };
}
async function upgrade(target = store, requestId = "durable-v3-continuation") {
  const wallet = createV3DurableWallet({ mode: MODE, store: target, clock });
  const before = await wallet.snapshot();
  const command = v3Command("continueFromV2", OPERATOR, requestId, { checkpoint: checkpoint(before) });
  const execution = await upgradeDurableWalletV3({ mode: MODE, store: target, command, acknowledgeVersionUpgrade: true, clock });
  return { wallet, before, command, execution };
}
async function initialPlan(wallet = createV3DurableWallet({ mode: MODE, store, clock })) {
  const before = await wallet.snapshot();
  if (!isV3State(before.state)) throw new Error("Fixture requires v3");
  const fixture = createV3InitialAcceptanceFixture({ mode: MODE, state: before.state,
    walletRevision: before.revision, walletEventHash: before.eventHash, atMs: now + 1,
    walletListingId: LISTING, walletTradeId: TRADE, platformRequestId: REQUEST, buyerId: BUYER.id,
    amount: "200", retainedPrice: "3.10" });
  const command = v3Command("acceptInitialSellerRequest", SELLER, "durable-v3-accept", initialInputFromPlan(fixture.plan));
  return { before, fixture, command };
}
async function ready() { await seedV2(); const upgraded = await upgrade(); return { ...upgraded, ...await initialPlan(upgraded.wallet) }; }
async function acquire(tx: WalletSql, protocol = "simulation-v3") {
  await tx.query("SELECT set_config('alpha_wallet.writer_protocol', $1, true)", [protocol]);
  await tx.query("UPDATE alpha_wallet_simulation.head SET lock_version=lock_version+1 WHERE singleton=true");
}
/** Deliberately bypass the repository to test storage constraints independently. */
async function insertCommand(tx: WalletSql, before: V3WalletSnapshot, command: V3VersionedCommand,
  result: unknown = null, state = before.state) {
  const revision = before.revision + 1, at = before.lastCommandAtMs + 1, commandKey = v3CommandKey(command);
  const inputHash = walletDigest(command), resultHash = walletDigest(result), stateHash = walletDigest(state);
  const eventHash = walletDigest({ revision, commandKey, at, inputHash, resultHash, stateHash, previousHash: before.eventHash });
  await tx.query(`INSERT INTO alpha_wallet_simulation.commands(revision,command_key,command_type,occurred_at_ms,command_json,input_hash,
    result_json,result_hash,state_hash,previous_event_hash,event_hash) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11)`,
  [revision, commandKey, command.type, at, JSON.stringify(command), inputHash, JSON.stringify(walletJson(result)), resultHash, stateHash, before.eventHash, eventHash]);
  return { revision, eventHash };
}
async function rawAcceptance(before: V3WalletSnapshot, command: V3Command,
  change: (delta: V3Projection) => void = () => undefined,
  late?: (tx: WalletSql, revision: number) => Promise<void>) {
  return store.transaction(async tx => {
    await acquire(tx);
    const applied = applyV3Command(before.state, command, { ...checkpoint(before), at: before.lastCommandAtMs + 1 });
    const event = await insertCommand(tx, before, command, applied.result, applied.state);
    const delta = v3ProjectionDelta(before.state, applied.state, event.revision);
    change(delta);
    await writeV3Projection(tx, delta);
    await tx.query("UPDATE alpha_wallet_simulation.head SET revision=$1,last_event_hash=$2 WHERE singleton=true", [event.revision, event.eventHash]);
    if (late) await late(tx, event.revision);
  });
}

describe("explicit v3 durable financial continuation", () => {
  it("continues v2 atomically, preserves every historical row, and reopens with the original continuation identity", async () => {
    await seedV2();
    const original = await rows(), prior = await footprint();
    const { wallet, before, command, execution } = await upgrade();
    const snapshot = await wallet.snapshot();
    expect(snapshot.engineVersion).toBe(WALLET_V3_ENGINE_VERSION);
    expect(snapshot.revision).toBe(before.revision + 1);
    expect(snapshot.state.accounts).toEqual(before.state.accounts);
    expect(snapshot.state.journal).toEqual(before.state.journal);
    expect((await rows()).slice(0, original.length)).toEqual(original);
    for (const name of OLD_TABLES.filter(name => name !== "commands")) expect((await footprint()).tables[name]).toEqual(prior.tables[name]);
    expect(await upgradeDurableWalletV3({ mode: MODE, store, command, acknowledgeVersionUpgrade: true, clock }))
      .toEqual({ ...execution, replayed: true });
    expect(await wallet.execute(command)).toEqual({ ...execution, replayed: true });
    await expect(upgrade(store, "other-upgrade")).rejects.toThrow(/intact v2 history/);
    await store.close();
    store = await createFileWalletStore({ mode: MODE, dataDir });
    expect(await createV3DurableWallet({ mode: MODE, store }).snapshot()).toEqual(snapshot);
    expect(verifyV3History(await rows())).toEqual(snapshot);
  }, TIMEOUT);

  it("reads a historical store without upgrading it and refuses implicit continuation or a direct v1-to-v3 jump", async () => {
    await initializeDurableWallet(store);
    const wallet = createV3DurableWallet({ mode: MODE, store, clock });
    const original = await wallet.snapshot();
    const invalid = v3Command("continueFromV2", OPERATOR, "cannot-skip-v2", { checkpoint: checkpoint(original) });
    await expect(upgradeDurableWalletV3({ mode: MODE, store, command: invalid, acknowledgeVersionUpgrade: true, clock }))
      .rejects.toThrow(/intact v2/);
    expect((await footprint()).layout).not.toContain("initial_engine_continuations");
    const v2 = v2Command("continueFromV1", OPERATOR, "explicit-v2", { checkpoint: checkpoint(original) });
    await upgradeDurableWalletV2({ mode: MODE, store, command: v2, acknowledgeVersionUpgrade: true, clock });
    const before = await wallet.snapshot(), prior = await footprint();
    expect(before.engineVersion).toBe(WALLET_V2_ENGINE_VERSION);
    await expect(wallet.execute(v3Command("continueFromV2", OPERATOR, "implicit", { checkpoint: checkpoint(before) })))
      .rejects.toThrow(/explicit v3 continuation/);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("rejects missing acknowledgment, wrong actor, changed checkpoint and backward clock before migration DDL", async () => {
    const { snapshot } = await seedV2(), prior = await footprint();
    const command = v3Command("continueFromV2", OPERATOR, "invalid-upgrade", { checkpoint: checkpoint(snapshot) });
    await expect(upgradeDurableWalletV3({ mode: MODE, store, command, acknowledgeVersionUpgrade: false as true, clock }))
      .rejects.toThrow(/acknowledgment/);
    await expect(upgradeDurableWalletV3({ mode: MODE, store, command: { ...command, actor: SELLER }, acknowledgeVersionUpgrade: true, clock }))
      .rejects.toThrow(/operator/i);
    const stale = structuredClone(command); stale.input.checkpoint.stateHash = "f".repeat(64);
    await expect(upgradeDurableWalletV3({ mode: MODE, store, command: stale, acknowledgeVersionUpgrade: true, clock }))
      .rejects.toThrow(/checkpoint/);
    await expect(upgradeDurableWalletV3({ mode: MODE, store, command, acknowledgeVersionUpgrade: true, clock: () => snapshot.lastCommandAtMs - 1 }))
      .rejects.toThrow(/clock/);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("rolls back schema-only migration independently of the repository", async () => {
    const { snapshot } = await seedV2(), prior = await footprint();
    const command = v3Command("continueFromV2", OPERATOR, "ddl-without-command", { checkpoint: checkpoint(snapshot) });
    await expect(store.transaction(async tx => {
      await acquire(tx, "simulation-v2");
      await tx.exec("SET CONSTRAINTS ALL IMMEDIATE"); await tx.exec("SET CONSTRAINTS ALL DEFERRED");
      await tx.query("SELECT set_config('alpha_wallet.schema_upgrade','v2-to-v3',true)");
      await tx.query("SELECT set_config('alpha_wallet.v3_upgrade_command',$1,true)", [JSON.stringify(command)]);
      await tx.query("SELECT set_config('alpha_wallet.v3_upgrade_key',$1,true)", [v3CommandKey(command)]);
      await tx.exec(MIGRATION);
    })).rejects.toThrow(/foreign key|atomically/i);
    expect(await footprint()).toEqual(prior);
    expect((await createVersionedDurableWallet({ mode: MODE, store }).snapshot()).state).toEqual(snapshot.state);
  }, TIMEOUT);

  it("aborts a certified outer transaction after a swallowed semantic failure following DDL and command insertion", async () => {
    const { snapshot } = await seedV2(), prior = await footprint();
    const command = v3Command("continueFromV2", OPERATOR, "swallowed-migration", { checkpoint: checkpoint(snapshot) });
    const failure = new Error("Synthetic failure after v3 command append");
    let migrated = false, inserted = false, caught: unknown;
    await expect(store.transaction(async tx => {
      const wrapped: WalletSql = {
        exec: async sql => { await tx.exec(sql); if (sql === MIGRATION) migrated = true; },
        async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
          if (sql.includes("UPDATE alpha_wallet_simulation.head SET revision=")) throw failure;
          const answer = await tx.query<Row>(sql, params);
          if (sql.includes("INSERT INTO alpha_wallet_simulation.commands")) inserted = true;
          return answer;
        },
      };
      try { await upgradeDurableWalletV3({ mode: MODE, store: bound(wrapped), command, acknowledgeVersionUpgrade: true, clock }); }
      catch (error) { caught = error; }
    })).rejects.toThrow(/division by zero|aborted/i);
    expect(caught).toBe(failure); expect(migrated && inserted).toBe(true);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("never aborts an uncertified or changed transaction identity", async () => {
    const failure = new Error("Synthetic failure at a write gate");
    for (const identities of [["41", "42"], ["41", "41", "42"]]) {
      const queries: string[] = []; let count = 0;
      const tx: WalletSql = { exec: async () => { throw new Error("Unexpected DDL"); },
        async query<Row extends Record<string, unknown>>(sql: string) {
          queries.push(sql);
          if (sql.includes("txid_current()")) return { rows: [{ transaction_id: identities[count++],
            isolation: "serializable", read_only: "off", development_mode: MODE }] as unknown as Row[] };
          if (sql.includes("FROM pg_namespace")) return { rows: [] as Row[] };
          if (sql.startsWith("SELECT format_version,mode")) return { rows: [{ format_version: 2, mode: MODE }] as unknown as Row[] };
          if (sql.startsWith("SELECT set_config")) return { rows: [] as Row[] };
          if (sql.startsWith("UPDATE alpha_wallet_simulation.head")) throw failure;
          throw new Error("Unexpected identity fixture query");
        } };
      const operation = createV3DurableWallet({ mode: MODE, store: bound(tx), clock }).snapshot();
      if (identities.length === 2) await expect(operation).rejects.toThrow(/identity changed/);
      else await expect(operation).rejects.toBe(failure);
      expect(queries.some(sql => sql.includes("SELECT 1 / 0"))).toBe(false);
      if (identities.length === 2) expect(queries.some(sql => sql.startsWith("UPDATE"))).toBe(false);
    }
  }, TIMEOUT);

  it.each([
    ["read committed", "off", MODE], ["serializable", "on", MODE], ["serializable", "off", null],
  ])("requires a certified writable simulation transaction: %s / %s / %s", async (isolation, read_only, development_mode) => {
    const query = vi.fn(async () => ({ rows: [{ transaction_id: "71", isolation, read_only, development_mode }] }));
    const tx = { query, exec: vi.fn() } as unknown as WalletSql;
    await expect(createV3DurableWallet({ mode: MODE, store: bound(tx) }).snapshot()).rejects.toThrow(/writable SERIALIZABLE/);
    expect(query).toHaveBeenCalledTimes(1);
  }, TIMEOUT);

  it("refuses any canonical coordination namespace before upgrade, including an empty one", async () => {
    const { snapshot } = await seedV2(), prior = await footprint();
    await store.transaction(tx => tx.exec("CREATE SCHEMA alpha_wallet_marketplace_simulation"));
    const command = v3Command("continueFromV2", OPERATOR, "no-cohort-upgrade", { checkpoint: checkpoint(snapshot) });
    await expect(upgradeDurableWalletV3({ mode: MODE, store, command, acknowledgeVersionUpgrade: true, clock }))
      .rejects.toThrow(/canonical coordination namespace/);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("refuses a canonical namespace introduced after the financial write and rolls all work back", async () => {
    const { command } = await ready(), prior = await footprint();
    let inserted = false;
    await expect(store.transaction(async tx => {
      const wrapped: WalletSql = { exec: sql => tx.exec(sql),
        async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
          const answer = await tx.query<Row>(sql, params);
          if (sql.includes("UPDATE alpha_wallet_simulation.head SET revision=")) {
            inserted = true; await tx.exec("CREATE SCHEMA alpha_wallet_marketplace_simulation");
          }
          return answer;
        } };
      try { await createV3DurableWallet({ mode: MODE, store: bound(wrapped), clock }).execute(command); }
      catch { /* A broken caller still cannot commit the one-sided write. */ }
    })).rejects.toThrow(/division by zero|aborted|isolated simulation-v3/i);
    expect(inserted).toBe(true); expect(await footprint()).toEqual(prior);
    expect((await store.transaction(tx => tx.query("SELECT nspname FROM pg_namespace WHERE nspname='alpha_wallet_marketplace_simulation'"))).rows).toEqual([]);
  }, TIMEOUT);

  it("commits the full principal with retained-request pricing, one binding and one original receipt", async () => {
    const { wallet, before, command } = await ready();
    const execution = await wallet.execute(command), after = await wallet.snapshot();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.state.trades.get(TRADE)).toMatchObject({ sellerId: SELLER.id, buyerId: BUYER.id, amountRaw: BigInt(200_000_000),
      fiatTotalMinor: BigInt(62620), status: "reserved" });
    expect(after.state.listings.get(LISTING)?.price).toBe("3.20");
    expect(balance(after.state, TRON, `listing:${LISTING}`)).toBe(BigInt(300_000_000));
    expect(balance(after.state, TRON, `trade:${TRADE}`)).toBe(BigInt(200_000_000));
    expect(expectedCustody(after.state, TRON)).toBe(expectedCustody(before.state, TRON));
    expect(after.state.journal.length).toBe(before.state.journal.length + 1);
    expect(after.state.payouts.size).toBe(0); expect(after.state.commissions.size).toBe(0);
    if (!isV3State(after.state)) throw new Error("Missing v3 state");
    expect(after.state.initialBindings.size).toBe(1); expect(after.state.initialAcceptanceReceipts.size).toBe(1);
    expect(after.state.termsBindings.size).toBe(0); expect(after.state.acceptanceReceipts.size).toBe(0);
    expect(after.state.initialBindings.get(REQUEST)?.terms.pricePerUsdt).toBe("3.10");
    expect(execution.result).toMatchObject({ commandRevision: after.revision, commandKey: execution.commandKey,
      actorUserId: SELLER.id, buyerId: BUYER.id, principalRaw: "200000000", transferAmountRaw: "200000000" });
    expect(verifyV3History(await rows())).toEqual(after);
  }, TIMEOUT);

  it("recovers the original business receipt across transport retries and after pause without appending again", async () => {
    const { wallet, command } = await ready();
    const execution = await wallet.execute(command);
    await wallet.execute(v3Command("pause", OPERATOR, "pause-after-accept", null));
    const prior = await footprint(), snapshot = await wallet.snapshot();
    expect(await wallet.execute({ ...command, requestId: "different-transport" })).toEqual({ ...execution, replayed: true });
    const mutated = await wallet.execute(command); mutated.result.principalRaw = "1";
    expect((await wallet.execute(command)).result.principalRaw).toBe("200000000");
    const changed = structuredClone(command); changed.input.buyerRequestEvidence.submissionTimelineDigest = "f".repeat(64);
    await expect(wallet.execute(changed)).rejects.toThrow(/Idempotency key/);
    await expect(wallet.execute({ ...changed, requestId: "changed-input-new-transport" })).rejects.toThrow(/different actor or input/);
    expect(await footprint()).toEqual(prior); expect(await wallet.snapshot()).toEqual(snapshot);
  }, TIMEOUT);

  it("serializes competing local transport retries into one command and one reservation", async () => {
    const { wallet, command } = await ready();
    const results = await Promise.all([wallet.execute(command), wallet.execute({ ...command, requestId: "second-transport" })]);
    expect(results.filter(result => !result.replayed)).toHaveLength(1);
    expect(new Set(results.map(result => result.commandKey)).size).toBe(1);
    expect(new Set(results.map(result => result.eventHash)).size).toBe(1);
    expect((await rows()).filter(row => row.command_type === "acceptInitialSellerRequest")).toHaveLength(1);
    expect(balance((await wallet.snapshot()).state, TRON, `trade:${TRADE}`)).toBe(BigInt(200_000_000));
  }, TIMEOUT);

  it("refuses stale or unauthorized descriptors without changing any durable row", async () => {
    const { wallet, before, command } = await ready(), prior = await footprint();
    await expect(wallet.execute({ ...command, actor: BUYER })).rejects.toThrow(/seller/i);
    const stale = structuredClone(command); stale.input.preconditions.walletEventHash = "f".repeat(64);
    await expect(wallet.execute(stale)).rejects.toThrow(/checkpoint|digest/i);
    const oldClock = createV3DurableWallet({ mode: MODE, store, clock: () => before.lastCommandAtMs - 1 });
    await expect(oldClock.execute(command)).rejects.toThrow(/clock/);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("records a swallowed runtime refusal after command insertion as a rollback even after environment restoration", async () => {
    const { command } = await ready(), prior = await footprint();
    let inserted = false, caught: unknown;
    await expect(store.transaction(async tx => {
      const wrapped: WalletSql = { exec: sql => tx.exec(sql),
        async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
          const answer = await tx.query<Row>(sql, params);
          if (sql.includes("INSERT INTO alpha_wallet_simulation.commands")) {
            inserted = true; vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", "true");
          }
          return answer;
        } };
      try { await createV3DurableWallet({ mode: MODE, store: bound(wrapped), clock }).execute(command); }
      catch (error) { caught = error; }
      finally { vi.stubEnv("ALPHA_WALLET_SIGNING_ENABLED", undefined); }
    })).rejects.toThrow(/mainnet or signing/);
    expect(inserted).toBe(true); expect(caught).toBeInstanceOf(Error); expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("rolls back financial projections on a real SQL rejection after inserting the binding", async () => {
    const { command } = await ready(), prior = await footprint();
    let bindingWritten = false;
    await expect(store.transaction(async tx => {
      const wrapped: WalletSql = { exec: sql => tx.exec(sql),
        async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
          const answer = await tx.query<Row>(sql, params);
          if (sql.includes("INSERT INTO alpha_wallet_simulation.initial_trade_bindings")) {
            bindingWritten = true; await tx.query("SELECT 1 / 0 /* real failed write fixture */");
          }
          return answer;
        } };
      try { await createV3DurableWallet({ mode: MODE, store: bound(wrapped), clock }).execute(command); }
      catch { /* owner must reject the caught SQL failure */ }
    })).rejects.toThrow(/division by zero|aborted/i);
    expect(bindingWritten).toBe(true); expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("fences old constructors, old backup and every new historical command after v3", async () => {
    const { wallet } = await ready(), prior = await footprint();
    await expect(initializeDurableWallet(store)).rejects.toThrow(/Unsupported/);
    await expect(createDurableWallet({ mode: MODE, store }).snapshot()).rejects.toThrow(/simulation-v3/);
    await expect(createVersionedDurableWallet({ mode: MODE, store }).snapshot()).rejects.toThrow(/simulation-v3/);
    await expect(exportVersionedWalletBackup({ mode: MODE, store })).rejects.toThrow(/Unsupported/);
    await expect(wallet.execute(walletCommand("pause", OPERATOR, "new-old-pause", null))).rejects.toThrow(/v3 envelope/);
    await expect(wallet.execute(v2Command("reserveTrade", BUYER, "new-old-reserve", {
      id: TRADE, listingId: LISTING, amount: "200", destination: simulatedDestination(TRON, BUYER.id),
    }))).rejects.toThrow(/v3 envelope/);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);
});

describe("independent v3 SQL projection and protocol guards", () => {
  it.each([
    ["missing binding", (delta: V3Projection) => { delta.initialBindings = []; }],
    ["missing receipt", (delta: V3Projection) => { delta.initialAcceptances = []; }],
    ["missing principal journal", (delta: V3Projection) => { delta.journals = []; delta.entries = []; }],
    ["net principal instead of full principal", (delta: V3Projection) => {
      delta.entries[0]!.delta_units = "-198000000"; delta.entries[1]!.delta_units = "198000000";
    }],
    ["different trade allocation", (delta: V3Projection) => { delta.entries[1]!.account = "trade:other-buyer-trade"; }],
    ["changed receipt actor", (delta: V3Projection) => { (delta.initialAcceptances[0]!.payload as Record<string, unknown>).actorUserId = BUYER.id; }],
    ["changed retained binding price", (delta: V3Projection) => {
      ((delta.initialBindings[0]!.payload as Record<string, unknown>).terms as Record<string, unknown>).pricePerUsdt = "3.20";
    }],
    ["different platform trade identity", (delta: V3Projection) => { delta.initialBindings[0]!.platform_trade_id = "another-platform-trade"; }],
    ["changed reservation journal operation", (delta: V3Projection) => { delta.journals[0]!.operation = "pretend-buyer-reservation"; }],
  ] as const)("rejects %s and rolls back the entire attempted append", async (_name, mutate) => {
    const { before, command } = await ready(), prior = await footprint();
    await expect(rawAcceptance(before, command, mutate)).rejects.toThrow();
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("rechecks principal integrity after a caller flushes constraints and appends a late balanced journal", async () => {
    const { before, command } = await ready(), prior = await footprint();
    await expect(rawAcceptance(before, command, () => undefined, async (tx, revision) => {
      await tx.exec("SET CONSTRAINTS ALL IMMEDIATE"); await tx.exec("SET CONSTRAINTS ALL DEFERRED");
      await tx.query(`INSERT INTO alpha_wallet_simulation.journals(journal_id,command_revision,asset_id,operation)
        VALUES('late-financial-journal',$1,$2,'late-balanced-write')`, [revision, TRON]);
      await tx.query(`INSERT INTO alpha_wallet_simulation.entries(journal_id,asset_id,account,delta_units)
        VALUES('late-financial-journal',$1,$2,-1),('late-financial-journal',$1,$3,1)`, [TRON, `listing:${LISTING}`, `available:${SELLER.id}`]);
    })).rejects.toThrow(/exactly one full-principal journal/);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it.each(NEW_TABLES)("makes %s immutable under update, delete and truncate", async table => {
    const { wallet, command } = await ready(); await wallet.execute(command);
    const prior = await footprint();
    for (const operation of ["UPDATE", "DELETE", "TRUNCATE"]) {
      const sql = operation === "UPDATE" ? `UPDATE alpha_wallet_simulation.${table} SET command_revision=command_revision`
        : operation === "DELETE" ? `DELETE FROM alpha_wallet_simulation.${table}` : `TRUNCATE alpha_wallet_simulation.${table} CASCADE`;
      await expect(store.transaction(tx => tx.exec(sql))).rejects.toThrow(/immutable/i);
    }
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it.each(["simulation-v1", "simulation-v2", "", "simulation-v4"])("refuses the obsolete or unknown SQL writer protocol %s", async protocol => {
    await ready(); const prior = await footprint();
    await expect(store.transaction(tx => acquire(tx, protocol))).rejects.toThrow(/isolated simulation-v3/);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it.each([1, 2, 4])("rejects a direct raw version %s append even with the current SQL writer protocol", async version => {
    const { before } = await ready(), prior = await footprint();
    const command = { ...v3Command("pause", OPERATOR, `raw-version-${version}`, null), version,
      engineVersion: `alpha-wallet-simulation-v${version}` } as unknown as V3VersionedCommand;
    await expect(store.transaction(async tx => { await acquire(tx); await insertCommand(tx, before, command, { halted: true }); }))
      .rejects.toThrow(/unknown engines|legacy appends/);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("rejects a raw unknown v3 operation and a seller impersonated as a buyer", async () => {
    const { before, command } = await ready(), prior = await footprint();
    const unknown = { ...command, type: "reserveTrade" } as unknown as V3VersionedCommand;
    const buyer = { ...command, actor: BUYER };
    for (const invalid of [unknown, buyer]) {
      await expect(store.transaction(async tx => { await acquire(tx); await insertCommand(tx, before, invalid); }))
        .rejects.toThrow(/unknown engines|unsupported actions|legacy appends/);
    }
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("rejects head downgrade and append-only registry replay after the explicit transition", async () => {
    await ready(); const prior = await footprint();
    await expect(store.transaction(async tx => { await acquire(tx);
      await tx.query("UPDATE alpha_wallet_simulation.head SET format_version=2 WHERE singleton=true");
    })).rejects.toThrow(/exact v3 continuation/);
    await expect(store.transaction(async tx => { await acquire(tx);
      await tx.query(`INSERT INTO alpha_wallet_simulation.initial_engine_continuations
        (command_revision,command_key,source_revision,source_event_hash,source_state_hash,source_occurred_at_ms)
        SELECT command_revision,command_key,source_revision,source_event_hash,source_state_hash,source_occurred_at_ms
        FROM alpha_wallet_simulation.initial_engine_continuations`);
    })).rejects.toThrow(/explicit v2 migration|duplicate/i);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("cannot append old projections even when the old history and v3 upgrade share the same transaction", async () => {
    await expect(store.transaction(async tx => {
      const scoped = bound(tx);
      const original = await seedV2(scoped);
      await upgrade(scoped);
      await tx.query(`INSERT INTO alpha_wallet_simulation.journals(journal_id,command_revision,asset_id,operation)
        VALUES('late-v2-history',$1,$2,'late-past-command')`, [original.snapshot.revision, TRON]);
    })).rejects.toThrow(/historical projections are sealed/);
    const found = await store.transaction(tx => tx.query("SELECT nspname FROM pg_namespace WHERE nspname='alpha_wallet_simulation'"));
    expect(found.rows).toEqual([]);
  }, TIMEOUT);

  it("rejects extra projections observed during replay instead of silently accepting drift", async () => {
    const { wallet, command } = await ready(); await wallet.execute(command);
    const prior = await footprint();
    const wrapped: WalletStore = { close: async () => undefined, transaction: work => store.transaction(tx => work({
      exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const answer = await tx.query<Row>(sql, params);
        if (sql.includes("FROM alpha_wallet_simulation.initial_acceptance_receipts") && answer.rows.length) {
          return { rows: [...answer.rows, structuredClone(answer.rows[0]!)] };
        }
        return answer;
      },
    })) };
    await expect(createV3DurableWallet({ mode: MODE, store: wrapped }).snapshot()).rejects.toThrow(/initialAcceptances disagree/);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);
});
