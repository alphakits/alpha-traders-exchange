// @vitest-environment node
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUYER, OPERATOR, SELLER, TRON } from "../../../scripts/alpha-wallet/durable-fixtures";
import { buildV3AcceptanceFixture, V3_FIXTURE_LISTING, V3_FIXTURE_TRADE, v3FixtureCheckpoint,
  v3FixtureHistory } from "../../../scripts/alpha-wallet/v3-durable-fixtures";
import { buildV4CancellationFixture, v4FixtureCancellationInput } from "../../../scripts/alpha-wallet/v4-durable-fixtures";
import { walletDigest, walletJson } from "./commands";
import { createDurableWallet } from "./durable";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { balance, expectedCustody } from "./ledger";
import { createVersionedDurableWallet } from "./versioned-durable";
import { createV3DurableWallet } from "./v3-durable";
import { v3Command } from "./v3-commands";
import { cancellationPlannerDigest, v4Command, v4CommandKey, type V4Command } from "./v4-commands";
import { createV4DurableWallet, upgradeDurableWalletV4, verifyV4History, type V4WalletSnapshot } from "./v4-durable";
import { applyV4Command, baseV3StateForV4, isV4State } from "./v4-engine";
import { v4ProjectionDelta, writeV4Projection, type V4Projection } from "./v4-projections";

const MODE = "simulation-only" as const, TIMEOUT = 120_000;
const MIGRATION = readFileSync(new URL("../../../docs/alpha-wallet/durable-v4-migration.sql", import.meta.url), "utf8");
const HISTORICAL = ["journals", "entries", "payout_intents", "payout_events", "chain_event_claims", "engine_continuations",
  "trade_terms_events", "acceptance_receipts", "initial_engine_continuations", "initial_trade_bindings", "initial_acceptance_receipts"];
let directory: string, dataDir: string, store: WalletStore;
const bound = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("TZ", "UTC");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-v4-durable-")); dataDir = join(directory, "wallet");
  store = await createFileWalletStore({ mode: MODE, dataDir });
}, TIMEOUT);
afterEach(async () => {
  try { await store?.close(); } finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); } finally { vi.unstubAllEnvs(); }
  }
}, TIMEOUT);
async function footprint() {
  return store.transaction(async tx => {
    const layout = (await tx.query<{ name: string }>(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='alpha_wallet_simulation' AND c.relkind='r' ORDER BY c.relname`)).rows.map(row => row.name);
    const tables: Record<string, unknown> = {};
    for (const name of ["commands", ...HISTORICAL, "cancellation_engine_continuations", "initial_cancellation_receipts"]) if (layout.includes(name)) {
      tables[name] = (await tx.query(`SELECT to_jsonb(record) AS payload FROM alpha_wallet_simulation.${name} record ORDER BY to_jsonb(record)::text`)).rows;
    }
    return { layout, tables, head: (await tx.query("SELECT revision,last_event_hash,format_version FROM alpha_wallet_simulation.head")).rows };
  });
}
async function acquire(tx: WalletSql, protocol = "simulation-v4") {
  await tx.query("SELECT set_config('alpha_wallet.writer_protocol',$1,true)", [protocol]);
  await tx.query("UPDATE alpha_wallet_simulation.head SET lock_version=lock_version+1 WHERE singleton=true");
}
async function rawCancellation(before: V4WalletSnapshot, command: V4Command,
  change: (delta: V4Projection) => void = () => undefined,
  late?: (tx: WalletSql, revision: number) => Promise<void>, rewriteResult?: (result: unknown) => void) {
  return store.transaction(async tx => {
    await acquire(tx);
    const at = before.lastCommandAtMs + 1, revision = before.revision + 1;
    const applied = applyV4Command(before.state, command, { ...v3FixtureCheckpoint(before), at });
    rewriteResult?.(applied.result);
    const commandKey = v4CommandKey(command), inputHash = walletDigest(command), resultHash = walletDigest(applied.result), stateHash = walletDigest(applied.state);
    const eventHash = walletDigest({ revision, commandKey, at, inputHash, resultHash, stateHash, previousHash: before.eventHash });
    await tx.query(`INSERT INTO alpha_wallet_simulation.commands(revision,command_key,command_type,occurred_at_ms,command_json,input_hash,
      result_json,result_hash,state_hash,previous_event_hash,event_hash) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11)`,
    [revision, commandKey, command.type, at, JSON.stringify(command), inputHash, JSON.stringify(walletJson(applied.result)), resultHash, stateHash, before.eventHash, eventHash]);
    const delta = v4ProjectionDelta(before.state, applied.state, revision); change(delta);
    await writeV4Projection(tx, delta);
    await tx.query("UPDATE alpha_wallet_simulation.head SET revision=$1,last_event_hash=$2 WHERE singleton=true", [revision, eventHash]);
    if (late) await late(tx, revision);
  });
}

describe("isolated V4 durable cancellation foundation", () => {
  it("continues exact V3 history without rewriting any old row and persists the frozen source", async () => {
    const original = await buildV3AcceptanceFixture(store);
    const prior = await footprint(), history = await store.transaction(tx => v3FixtureHistory(tx));
    const command = v4Command("continueFromV3", OPERATOR, "exact-upgrade", { checkpoint: v3FixtureCheckpoint(original.snapshot) });
    const result = await upgradeDurableWalletV4({ mode: MODE, store, command, acknowledgeVersionUpgrade: true, clock: () => original.now() + 1 });
    const wallet = createV4DurableWallet({ mode: MODE, store }), snapshot = await wallet.snapshot();
    expect(isV4State(snapshot.state)).toBe(true);
    if (!isV4State(snapshot.state)) throw new Error("Expected V4");
    expect(baseV3StateForV4(snapshot.state)).toEqual(original.snapshot.state);
    expect((await store.transaction(tx => v3FixtureHistory(tx))).slice(0, history.length)).toEqual(history);
    for (const name of HISTORICAL) expect((await footprint()).tables[name]).toEqual(prior.tables[name]);
    expect(await upgradeDurableWalletV4({ mode: MODE, store, command, acknowledgeVersionUpgrade: true }))
      .toEqual({ ...result, replayed: true });
    expect(await wallet.execute(command)).toEqual({ ...result, replayed: true });
    await expect(upgradeDurableWalletV4({ mode: MODE, store, command: { ...command, requestId: "second-upgrade" }, acknowledgeVersionUpgrade: true }))
      .rejects.toThrow(/intact v3/);
    expect(verifyV4History(await store.transaction(tx => v3FixtureHistory(tx)))).toEqual(snapshot);
  }, TIMEOUT);

  it("returns exactly 200 reserved units to the same 300-unit listing, with no payout, fee or loss of custody", async () => {
    const fixture = await buildV4CancellationFixture(store);
    expect(balance(fixture.before.state, TRON, `listing:${V3_FIXTURE_LISTING}`)).toBe(BigInt(300_000_000));
    expect(balance(fixture.snapshot.state, TRON, `listing:${V3_FIXTURE_LISTING}`)).toBe(BigInt(500_000_000));
    expect(balance(fixture.snapshot.state, TRON, `trade:${V3_FIXTURE_TRADE}`)).toBe(BigInt(0));
    expect(fixture.snapshot.state.trades.get(V3_FIXTURE_TRADE)?.status).toBe("cancelled");
    expect(expectedCustody(fixture.snapshot.state, TRON)).toBe(expectedCustody(fixture.before.state, TRON));
    expect(fixture.snapshot.state.payouts).toEqual(fixture.before.state.payouts);
    expect(fixture.snapshot.state.commissions).toEqual(fixture.before.state.commissions);
    expect(fixture.snapshot.state.journal.length).toBe(fixture.before.state.journal.length + 1);
    expect(fixture.execution?.result.principalRaw).toBe("200000000");
    expect(await fixture.wallet.execute({ ...fixture.cancellation, requestId: "another-transport-request" }))
      .toEqual({ ...fixture.execution, replayed: true });
    expect(await fixture.wallet.snapshot()).toEqual(fixture.snapshot);
    await store.close(); store = await createFileWalletStore({ mode: MODE, dataDir });
    expect(await createV4DurableWallet({ mode: MODE, store }).snapshot()).toEqual(fixture.snapshot);
  }, TIMEOUT);

  it("recovers original acceptance and unknown dispatch receipts after cancellation without dispatching again", async () => {
    const fixture = await buildV4CancellationFixture(store);
    expect(await fixture.wallet.execute({ ...fixture.original.acceptance, requestId: "recover-original-acceptance" }))
      .toEqual({ ...fixture.original.execution, replayed: true });
    const dispatch = await fixture.wallet.execute(fixture.original.historicalDispatch!);
    expect(dispatch.replayed).toBe(true); expect(dispatch.result.shouldDispatch).toBe(false);
    expect(dispatch.result.payout.state).toBe("submission_unknown"); expect(dispatch.result.payout.dispatchCount).toBe(1);
    expect((await fixture.wallet.recoverPayouts()).some(row => row.action === "lookup_original_reference")).toBe(true);
    expect(await fixture.wallet.snapshot()).toEqual(fixture.snapshot);
  }, TIMEOUT);

  it("resolves a lost commit reply to the one immutable cancellation receipt", async () => {
    const fixture = await buildV4CancellationFixture(store, { cancel: false });
    const lost: WalletStore = { close: async () => undefined, transaction: async work => {
      await store.transaction(work); throw new CommitOutcomeUnknownError(new Error("Injected lost response after actual commit"));
    } };
    await expect(createV4DurableWallet({ mode: MODE, store: lost, clock: () => fixture.now() + 1 }).execute(fixture.cancellation))
      .rejects.toBeInstanceOf(CommitOutcomeUnknownError);
    const snapshot = await fixture.wallet.snapshot(), replay = await fixture.wallet.execute(fixture.cancellation);
    expect(replay.replayed).toBe(true); expect(replay.revision).toBe(fixture.before.revision + 1);
    expect(await fixture.wallet.snapshot()).toEqual(snapshot);
    expect(balance(snapshot.state, TRON, `listing:${V3_FIXTURE_LISTING}`)).toBe(BigInt(500_000_000));
  }, TIMEOUT);

  it.each(["alpha_wallet_marketplace_simulation", "alpha_wallet_initial_marketplace_simulation"])("refuses the existing canonical namespace %s without mutating it", async schema => {
    const fixture = await buildV3AcceptanceFixture(store), prior = await footprint();
    await store.transaction(tx => tx.exec(`CREATE SCHEMA ${schema}`));
    const command = v4Command("continueFromV3", OPERATOR, "closed-cohort", { checkpoint: v3FixtureCheckpoint(fixture.snapshot) });
    await expect(upgradeDurableWalletV4({ mode: MODE, store, command, acknowledgeVersionUpgrade: true }))
      .rejects.toThrow(/canonical coordination namespace/);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("rejects stale migration identity, acknowledgment and backward clock before creating V4 tables", async () => {
    const fixture = await buildV3AcceptanceFixture(store), prior = await footprint();
    const command = v4Command("continueFromV3", OPERATOR, "invalid-upgrade", { checkpoint: v3FixtureCheckpoint(fixture.snapshot) });
    await expect(upgradeDurableWalletV4({ mode: MODE, store, command, acknowledgeVersionUpgrade: false as true })).rejects.toThrow(/acknowledgment/);
    const changed = structuredClone(command); changed.input.checkpoint.stateHash = "f".repeat(64);
    await expect(upgradeDurableWalletV4({ mode: MODE, store, command: changed, acknowledgeVersionUpgrade: true, clock: () => fixture.now() + 1 })).rejects.toThrow(/checkpoint/);
    await expect(upgradeDurableWalletV4({ mode: MODE, store, command, acknowledgeVersionUpgrade: true, clock: () => fixture.now() - 1 })).rejects.toThrow(/clock/);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("rolls back a schema-only V4 upgrade independently of the repository", async () => {
    const fixture = await buildV3AcceptanceFixture(store), prior = await footprint();
    const command = v4Command("continueFromV3", OPERATOR, "incomplete-ddl", { checkpoint: v3FixtureCheckpoint(fixture.snapshot) });
    await expect(store.transaction(async tx => {
      await acquire(tx, "simulation-v3"); await tx.exec("SET CONSTRAINTS ALL IMMEDIATE"); await tx.exec("SET CONSTRAINTS ALL DEFERRED");
      await tx.query("SELECT set_config('alpha_wallet.schema_upgrade','v3-to-v4',true)");
      await tx.query("SELECT set_config('alpha_wallet.v4_upgrade_command',$1,true)", [JSON.stringify(command)]);
      await tx.query("SELECT set_config('alpha_wallet.v4_upgrade_key',$1,true)", [v4CommandKey(command)]);
      await tx.query("SELECT set_config('alpha_wallet.v4_source_halt_reason',$1,true)", [JSON.stringify(fixture.snapshot.state.haltReason)]);
      await tx.exec(MIGRATION);
    })).rejects.toThrow(/foreign key|atomically/i);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("retains an existing pause across continuation and refuses cancellation", async () => {
    const fixture = await buildV4CancellationFixture(store, { sourcePaused: true, cancel: false });
    expect(fixture.snapshot.state.haltReason).toBeTruthy();
    const prior = await footprint(); await expect(fixture.wallet.execute(fixture.cancellation)).rejects.toThrow(/paused|halt/i);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("SQL refuses a raw migration that claims an unpaused source despite its immutable V3 pause", async () => {
    const fixture = await buildV3AcceptanceFixture(store, { pause: true }), prior = await footprint();
    const command = v4Command("continueFromV3", OPERATOR, "forged-null-source-halt", { checkpoint: v3FixtureCheckpoint(fixture.snapshot) });
    await expect(store.transaction(async tx => {
      await acquire(tx, "simulation-v3"); await tx.exec("SET CONSTRAINTS ALL IMMEDIATE"); await tx.exec("SET CONSTRAINTS ALL DEFERRED");
      await tx.query("SELECT set_config('alpha_wallet.schema_upgrade','v3-to-v4',true)");
      await tx.query("SELECT set_config('alpha_wallet.v4_upgrade_command',$1,true)", [JSON.stringify(command)]);
      await tx.query("SELECT set_config('alpha_wallet.v4_upgrade_key',$1,true)", [v4CommandKey(command)]);
      await tx.query("SELECT set_config('alpha_wallet.v4_source_halt_reason','null',true)");
      await tx.exec(MIGRATION);
    })).rejects.toThrow(/preserve the immutable V3 pause/);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("fences all older writers and rejects new historical commands through the V4 reader", async () => {
    const fixture = await buildV4CancellationFixture(store, { cancel: false }), prior = await footprint();
    for (const wallet of [createDurableWallet({ mode: MODE, store }), createVersionedDurableWallet({ mode: MODE, store }), createV3DurableWallet({ mode: MODE, store })]) {
      await expect(wallet.snapshot()).rejects.toThrow();
    }
    await expect(fixture.wallet.execute(v3Command("pause", OPERATOR, "new-legacy-pause", null))).rejects.toThrow(/v4 continuation/);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("accepts the buyer only with exact actor-bound input and refuses a second party cancellation", async () => {
    const fixture = await buildV4CancellationFixture(store, { cancel: false });
    const command = v4Command("cancelInitialTrade", BUYER, "buyer-cancel", v4FixtureCancellationInput(fixture.before, fixture.now() + 1, BUYER.id));
    const accepted = await fixture.wallet.execute(command); expect(accepted.result.actorKind).toBe("buyer");
    const prior = await footprint(); await expect(fixture.wallet.execute(fixture.cancellation)).rejects.toThrow();
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it.each([
    ["missing receipt", (delta: V4Projection) => { delta.initialCancellations.length = 0; }],
    ["missing journal", (delta: V4Projection) => { delta.journals.length = 0; delta.entries.length = 0; }],
    ["wrong destination", (delta: V4Projection) => { delta.entries.find(row => BigInt(row.delta_units as string) > BigInt(0))!.account = "seller:wrong:available"; }],
    ["partial balanced return", (delta: V4Projection) => { for (const row of delta.entries) row.delta_units = (BigInt(row.delta_units as string) / BigInt(2)).toString(); }],
    ["changed receipt", (delta: V4Projection) => { (delta.initialCancellations[0]!.payload as Record<string, unknown>).listingAvailableAfterRaw = "999"; }],
    ["wrong journal operation", (delta: V4Projection) => { delta.journals[0]!.operation = "v4:other-operation"; }],
  ] as const)("SQL independently rejects %s and leaves the reservation intact", async (_name, change) => {
    const fixture = await buildV4CancellationFixture(store, { cancel: false }), prior = await footprint();
    await expect(rawCancellation(fixture.before, fixture.cancellation, change)).rejects.toThrow();
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("SQL rejects an extra payout even when the principal return is otherwise correct", async () => {
    const fixture = await buildV4CancellationFixture(store, { cancel: false }), prior = await footprint();
    await expect(rawCancellation(fixture.before, fixture.cancellation, undefined, async (tx, revision) => {
      await tx.query(`INSERT INTO alpha_wallet_simulation.payout_intents(payout_id,command_revision,asset_id,seller_id,kind,trade_id,amount_raw,destination,provider_reference)
        VALUES('illicit-cancel-payout',$1,$2,$3,'withdrawal',NULL,1,'sim:TRON:illicit','sim-illicit-reference')`, [revision, TRON, SELLER.id]);
    })).rejects.toThrow();
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("SQL refuses numeric JSON digests even when their text is 64 hexadecimal digits", async () => {
    const fixture = await buildV4CancellationFixture(store, { cancel: false }), prior = await footprint();
    await expect(rawCancellation(fixture.before, fixture.cancellation, delta => {
      (delta.initialCancellations[0]!.payload as Record<string, unknown>).inputDigest = 1e63;
    }, undefined, result => { (result as Record<string, unknown>).inputDigest = 1e63; }))
      .rejects.toThrow(/Cancellation receipt must record/);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("poisons the original certified transaction when a failure after receipt insertion is swallowed", async () => {
    const fixture = await buildV4CancellationFixture(store, { cancel: false }), prior = await footprint();
    const failure = new Error("Injected after cancellation receipt insert"); let inserted = false, caught: unknown;
    await expect(store.transaction(async tx => {
      const wrapped: WalletSql = { exec: sql => tx.exec(sql), async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await tx.query<Row>(sql, params);
        if (sql.includes("INSERT INTO alpha_wallet_simulation.initial_cancellation_receipts")) { inserted = true; throw failure; }
        return result;
      } };
      try { await createV4DurableWallet({ mode: MODE, store: bound(wrapped), clock: () => fixture.now() + 1 }).execute(fixture.cancellation); }
      catch (error) { caught = error; }
      await tx.query("SELECT 1");
    })).rejects.toThrow(/aborted/);
    expect(inserted).toBe(true); expect(caught).toBe(failure); expect(await footprint()).toEqual(prior);
  }, TIMEOUT);

  it("rolls back a companion pause when malformed input or upgrade acknowledgment is caught inside its owner", async () => {
    const fixture = await buildV4CancellationFixture(store, { cancel: false }), prior = await footprint();
    for (const kind of ["command", "upgrade"] as const) {
      await expect(store.transaction(async tx => {
        const scoped = createV4DurableWallet({ mode: MODE, store: bound(tx), clock: () => fixture.now() + 1 });
        await scoped.execute(v4Command("pause", OPERATOR, `companion-${kind}`, null));
        try {
          if (kind === "command") await scoped.execute({ ...fixture.cancellation, unexpected: true } as typeof fixture.cancellation);
          else await upgradeDurableWalletV4({ mode: MODE, store: bound(tx), command: fixture.command,
            acknowledgeVersionUpgrade: false as true });
        } catch { /* A caught participant refusal must not make the pause committable. */ }
        await tx.query("SELECT 1");
      })).rejects.toThrow(/aborted/);
      expect(await footprint()).toEqual(prior);
    }
  }, TIMEOUT);

  it("captures cancellation input before an asynchronous transaction owner can mutate it", async () => {
    const fixture = await buildV4CancellationFixture(store, { cancel: false }), input = structuredClone(fixture.cancellation);
    const changing: WalletStore = { close: async () => undefined, transaction: work => {
      input.input.principalReturn.transferAmountRaw = "1";
      input.actor.id = "unrelated-seller";
      return store.transaction(work);
    } };
    const result = await createV4DurableWallet({ mode: MODE, store: changing, clock: () => fixture.now() + 1 }).execute(input);
    expect(result.result.principalRaw).toBe("200000000"); expect(result.result.actorUserId).toBe(SELLER.id);
    expect(await fixture.wallet.execute(fixture.cancellation)).toEqual({ ...result, replayed: true });
  }, TIMEOUT);

  it("rejects a buyer's disclosed-bank cancellation and expired-listing assertions", async () => {
    const fixture = await buildV4CancellationFixture(store, { cancel: false }), prior = await footprint();
    const buyer = v4Command("cancelInitialTrade", BUYER, "disclosed-buyer", v4FixtureCancellationInput(fixture.before, fixture.now() + 1, BUYER.id));
    buyer.input.preconditions.buyerBankDetailsDisclosed = true;
    buyer.input.plannerInputDigest = cancellationPlannerDigest(buyer.input, BUYER.id);
    await expect(createV4DurableWallet({ mode: MODE, store, clock: () => fixture.now() + 1 }).execute(buyer)).rejects.toThrow(/disclos|bank/i);
    const expired = structuredClone(fixture.cancellation); expired.input.preconditions.listingExpiresAt = new Date(fixture.now()).toISOString();
    expired.input.plannerInputDigest = cancellationPlannerDigest(expired.input, SELLER.id);
    await expect(createV4DurableWallet({ mode: MODE, store, clock: () => fixture.now() + 1 }).execute(expired)).rejects.toThrow(/expir/i);
    expect(await footprint()).toEqual(prior);
  }, TIMEOUT);
});
