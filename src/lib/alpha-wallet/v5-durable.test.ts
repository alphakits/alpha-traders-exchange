// @vitest-environment node
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPERATOR, SELLER, TRON } from "../../../scripts/alpha-wallet/durable-fixtures";
import { v3FixtureCheckpoint, v3FixtureHistory, V3_FIXTURE_TRADE } from "../../../scripts/alpha-wallet/v3-durable-fixtures";
import { buildV4CancellationFixture } from "../../../scripts/alpha-wallet/v4-durable-fixtures";
import { buildV5PaymentFixture, v5FixtureClaimInput } from "../../../scripts/alpha-wallet/v5-durable-fixtures";
import { walletDigest } from "./commands";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { balance } from "./ledger";
import { v4Command } from "./v4-commands";
import { createV4DurableWallet } from "./v4-durable";
import { paymentClaimPlannerDigest, v5Command, v5CommandKey, type V5CommandOf } from "./v5-commands";
import { createV5DurableWallet, upgradeDurableWalletV5, verifyV5History, type V5WalletSnapshot } from "./v5-durable";
import { applyV5Command, baseV4StateForV5, isV5State, type V5InitialPaymentClaimReceipt } from "./v5-engine";
import { v5ProjectionDelta } from "./v5-projections";

const MODE = "simulation-only" as const, TIMEOUT = 120_000;
const MIGRATION = readFileSync(new URL("../../../docs/alpha-wallet/durable-v5-migration.sql", import.meta.url), "utf8");
let directory: string, dataDir: string, store: WalletStore;
const bound = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-v5-durable-")); dataDir = join(directory, "wallet");
  store = await createFileWalletStore({ mode: MODE, dataDir });
}, TIMEOUT);
afterEach(async () => {
  try { await store?.close(); } finally { try { await rm(directory, { recursive: true, force: true }); } finally { vi.unstubAllEnvs(); } }
}, TIMEOUT);
async function footprint() {
  return store.transaction(async tx => {
    const tables: Record<string, unknown> = {};
    const names = (await tx.query<{ name: string }>(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='alpha_wallet_simulation' AND c.relkind='r' AND c.relname<>'head' ORDER BY c.relname`)).rows;
    for (const { name } of names) tables[name] = (await tx.query(`SELECT to_jsonb(t) AS payload FROM alpha_wallet_simulation.${name} t ORDER BY to_jsonb(t)::text`)).rows;
    return { tables, head: (await tx.query("SELECT revision,last_event_hash,format_version FROM alpha_wallet_simulation.head")).rows };
  });
}
async function acquire(tx: WalletSql, protocol = "simulation-v5") {
  await tx.query("SELECT set_config('alpha_wallet.writer_protocol',$1,true)", [protocol]);
  await tx.query("UPDATE alpha_wallet_simulation.head SET lock_version=lock_version+1 WHERE singleton=true");
}
async function rawClaim(tx: WalletSql, snapshot: V5WalletSnapshot, command: V5CommandOf<"claimInitialPayment">,
  options: { omitReceipt?: boolean; mutate?: (command: V5CommandOf<"claimInitialPayment">, result: V5InitialPaymentClaimReceipt) => void; movePrincipal?: boolean } = {}) {
  const applied = applyV5Command(snapshot.state, command, { ...v3FixtureCheckpoint(snapshot), at: command.input.claimedAtMs });
  const attempted = structuredClone(command), result = structuredClone(applied.result as V5InitialPaymentClaimReceipt);
  options.mutate?.(attempted, result);
  const revision = snapshot.revision + 1, key = v5CommandKey(attempted), inputHash = walletDigest(attempted), resultHash = walletDigest(result), stateHash = walletDigest(applied.state);
  const eventHash = walletDigest({ revision, commandKey: key, at: attempted.input.claimedAtMs, inputHash, resultHash, stateHash, previousHash: snapshot.eventHash });
  await acquire(tx);
  await tx.query(`INSERT INTO alpha_wallet_simulation.commands(revision,command_key,command_type,occurred_at_ms,command_json,input_hash,
    result_json,result_hash,state_hash,previous_event_hash,event_hash) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11)`,
  [revision, key, attempted.type, attempted.input.claimedAtMs, JSON.stringify(attempted), inputHash, JSON.stringify(result), resultHash, stateHash, snapshot.eventHash, eventHash]);
  if (!options.omitReceipt) await tx.query(`INSERT INTO alpha_wallet_simulation.initial_payment_claim_receipts
    (claim_key,platform_request_id,wallet_trade_id,command_revision,payload) VALUES($1,$2,$3,$4,$5::jsonb)`,
  [result.claimKey, result.platformRequestId, result.walletTradeId, revision, JSON.stringify(result)]);
  if (options.movePrincipal) {
    const journalId = `journal-${snapshot.state.journal.length + 1}`, terms = command.input.terms;
    await tx.query("INSERT INTO alpha_wallet_simulation.journals(journal_id,command_revision,asset_id,operation) VALUES($1,$2,$3,$4)",
      [journalId, revision, terms.assetId, `v5:${key}`]);
    await tx.query("INSERT INTO alpha_wallet_simulation.entries(journal_id,asset_id,account,delta_units) VALUES($1,$2,$3,-1),($1,$2,$4,1)",
      [journalId, terms.assetId, `trade:${result.walletTradeId}`, `listing:${result.walletListingId}`]);
  }
  await tx.query("UPDATE alpha_wallet_simulation.head SET revision=$1,last_event_hash=$2 WHERE singleton=true", [revision, eventHash]);
}

describe("V5 durable continuation and recovery semantics", () => {
  it("persists a buyer claim/dispute with no financial delta and reopens the exact state", async () => {
    const f = await buildV5PaymentFixture(store, { dispute: true, unknownWithdrawal: true });
    expect(isV5State(f.snapshot.state)).toBe(true); if (!isV5State(f.snapshot.state)) throw new Error("V5 required");
    expect(baseV4StateForV5(f.snapshot.state)).toEqual(f.original.snapshot.state);
    expect(f.snapshot.state.accounts).toEqual(f.original.snapshot.state.accounts); expect(f.snapshot.state.journal).toEqual(f.original.snapshot.state.journal);
    expect(balance(f.snapshot.state, TRON, `trade:${V3_FIXTURE_TRADE}`)).toBe(BigInt("200000000"));
    const delta = v5ProjectionDelta(f.before.state, f.afterClaim.state, f.afterClaim.revision);
    expect(delta.initialPaymentClaims).toHaveLength(1);
    for (const [key, rows] of Object.entries(delta)) if (key !== "initialPaymentClaims") expect(rows, key).toEqual([]);
    const before = f.snapshot; await store.close(); store = await createFileWalletStore({ mode: MODE, dataDir });
    expect(await createV5DurableWallet({ mode: MODE, store }).snapshot()).toEqual(before);
    const replay = verifyV5History(await store.transaction(tx => v3FixtureHistory(tx))); expect(replay).toEqual(before);
    expect(await store.transaction(tx => tx.query("SELECT * FROM alpha_wallet_simulation.initial_dispute_freeze_receipts"))).toMatchObject({ rows: [{ wallet_trade_id: V3_FIXTURE_TRADE }] });
  }, TIMEOUT);
  it("preserves an unknown withdrawal and historical dispatch retry cannot dispatch again", async () => {
    const f = await buildV5PaymentFixture(store, { dispute: true, unknownWithdrawal: true });
    const command = f.original.original.historicalDispatch!;
    const retry = await f.wallet.execute(command); expect(retry.replayed).toBe(true);
    expect(retry.result).toMatchObject({ shouldDispatch: false, payout: { state: "submission_unknown", dispatchCount: 1 } });
    expect((await f.wallet.recoverPayouts())[0]).toMatchObject({ action: "lookup_original_reference", payout: { dispatchCount: 1 } });
    expect(await f.wallet.snapshot()).toEqual(f.snapshot);
  }, TIMEOUT);
  it("preserves cancelled V4 history and original cancellation receipt retries without new cancellation authority", async () => {
    const f = await buildV5PaymentFixture(store, { cancelledSource: true, claim: false, pause: true });
    const retry = await f.wallet.execute({ ...f.original.cancellation, requestId: "new-old-cancellation-transport" });
    expect(retry).toEqual({ ...f.original.execution, replayed: true });
    const before = await footprint(); await expect(f.wallet.execute(f.claimCommand)).rejects.toThrow();
    await expect(f.wallet.execute(v4Command("pause", OPERATOR, "fresh-old-pause", null))).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it("requires explicit version AND claim-only profile acknowledgment before DDL", async () => {
    const f = await buildV4CancellationFixture(store, { cancel: false }); const before = await footprint();
    const command = v5Command("continueFromV4", OPERATOR, "upgrade", { checkpoint: v3FixtureCheckpoint(f.snapshot) });
    for (const flags of [{ acknowledgeVersionUpgrade: true, acknowledgePaymentClaimOnlyProfile: false },
      { acknowledgeVersionUpgrade: false, acknowledgePaymentClaimOnlyProfile: true }]) {
      await expect(upgradeDurableWalletV5({ mode: MODE, store, command, ...flags as { acknowledgeVersionUpgrade: true; acknowledgePaymentClaimOnlyProfile: true },
        clock: () => f.now() + 1 })).rejects.toThrow(/acknowledgment/);
      expect(await footprint()).toEqual(before);
    }
  }, TIMEOUT);
  it("preserves a paused source and rejects source-hash drift atomically", async () => {
    const f = await buildV4CancellationFixture(store, { cancel: false, pause: true }); const before = await footprint();
    const command = v5Command("continueFromV4", OPERATOR, "upgrade", { checkpoint: { ...v3FixtureCheckpoint(f.snapshot), stateHash: "f".repeat(64) } });
    await expect(upgradeDurableWalletV5({ mode: MODE, store, command, acknowledgeVersionUpgrade: true, acknowledgePaymentClaimOnlyProfile: true, clock: () => f.now() + 1 })).rejects.toThrow();
    expect(await footprint()).toEqual(before);
    command.input.checkpoint.stateHash = walletDigest(f.snapshot.state);
    await upgradeDurableWalletV5({ mode: MODE, store, command, acknowledgeVersionUpgrade: true, acknowledgePaymentClaimOnlyProfile: true, clock: () => f.now() + 1 });
    const wallet = createV5DurableWallet({ mode: MODE, store, clock: () => f.now() + 2 }); const snapshot = await wallet.snapshot();
    expect(snapshot.state.haltReason).toBe(f.snapshot.state.haltReason);
    await expect(wallet.execute(v5Command("claimInitialPayment", { kind: "buyer", id: f.snapshot.state.trades.get(V3_FIXTURE_TRADE)!.buyerId },
      "paused-claim", v5FixtureClaimInput(snapshot, f.now() + 2)))).rejects.toThrow(/paused/);
  }, TIMEOUT);
  it("recovers a committed claim after an actual lost acknowledgement without a second receipt", async () => {
    const f = await buildV5PaymentFixture(store, { claim: false }); let lost = false;
    const uncertain: WalletStore = { transaction: async work => { const result = await store.transaction(work); if (!lost) { lost = true; throw new CommitOutcomeUnknownError(new Error("lost commit reply")); } return result; }, close: async () => undefined };
    const wallet = createV5DurableWallet({ mode: MODE, store: uncertain, clock: () => f.claimCommand.input.claimedAtMs });
    await expect(wallet.execute(f.claimCommand)).rejects.toBeInstanceOf(CommitOutcomeUnknownError);
    const retry = await wallet.execute({ ...f.claimCommand, requestId: "recover-claim" }); expect(retry.replayed).toBe(true);
    expect((await wallet.snapshot()).revision).toBe(f.before.revision + 1);
    expect((await store.transaction(tx => tx.query("SELECT * FROM alpha_wallet_simulation.initial_payment_claim_receipts"))).rows).toHaveLength(1);
  }, TIMEOUT);
});

describe("V5 SQL and physical transaction failure boundaries", () => {
  it.each(["INSERT INTO alpha_wallet_simulation.commands", "INSERT INTO alpha_wallet_simulation.initial_payment_claim_receipts", "UPDATE alpha_wallet_simulation.head SET revision="])(
    "rolls back every claim participant after injected failure at %s", async needle => {
      const f = await buildV5PaymentFixture(store, { claim: false }), before = await footprint();
      const broken: WalletStore = { transaction: work => store.transaction(tx => work({ async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
        const result = await tx.query<Row>(sql, values); if (sql.includes(needle)) throw new Error("injected-after-write"); return result;
      }, exec: sql => tx.exec(sql) })), close: async () => undefined };
      await expect(createV5DurableWallet({ mode: MODE, store: broken, clock: () => f.claimCommand.input.claimedAtMs }).execute(f.claimCommand)).rejects.toThrow("injected-after-write");
      expect(await footprint()).toEqual(before); expect((await f.wallet.execute(f.claimCommand)).replayed).toBe(false);
    }, TIMEOUT);
  it("aborts a caught invalid participant so companion writes cannot commit", async () => {
    const f = await buildV5PaymentFixture(store, { claim: false }), before = await footprint();
    await expect(store.transaction(async tx => {
      try { await createV5DurableWallet({ mode: MODE, store: bound(tx) }).execute({ ...f.claimCommand, privateKey: "forbidden" } as typeof f.claimCommand); }
      catch { /* callers cannot turn refusal into a partial commit */ }
      await tx.query("SELECT 1");
    })).rejects.toThrow(); expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it("rejects preparation-only migration at deferred commit", async () => {
    const f = await buildV4CancellationFixture(store, { cancel: false }), before = await footprint();
    const command = v5Command("continueFromV4", OPERATOR, "prepare-only", { checkpoint: v3FixtureCheckpoint(f.snapshot) });
    await expect(store.transaction(async tx => {
      await acquire(tx, "simulation-v4"); await tx.exec("SET CONSTRAINTS ALL IMMEDIATE"); await tx.exec("SET CONSTRAINTS ALL DEFERRED");
      await tx.query("SELECT set_config('alpha_wallet.schema_upgrade','v4-to-v5',true)");
      await tx.query("SELECT set_config('alpha_wallet.v5_claim_only_acknowledged','true',true)");
      await tx.query("SELECT set_config('alpha_wallet.v5_upgrade_command',$1,true)", [JSON.stringify(command)]);
      await tx.query("SELECT set_config('alpha_wallet.v5_upgrade_key',$1,true)", [v5CommandKey(command)]);
      await tx.query("SELECT set_config('alpha_wallet.v5_source_halt_reason','null',true)"); await tx.exec(MIGRATION);
    })).rejects.toThrow(); expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it.each(["missing receipt", "balanced principal movement"])("SQL refuses %s even when bypassing the reducer", async failure => {
    const f = await buildV5PaymentFixture(store, { claim: false }), before = await footprint();
    await expect(store.transaction(tx => rawClaim(tx, f.before, f.claimCommand, { omitReceipt: failure === "missing receipt", movePrincipal: failure === "balanced principal movement" }))).rejects.toThrow();
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it.each(["actor", "terms", "proof", "principal", "state basis", "receipt digest", "private field"])(
    "SQL independently refuses rebound %s after rehashed command/result/event commitments", async field => {
      const f = await buildV5PaymentFixture(store, { claim: false }), before = await footprint();
      await expect(store.transaction(tx => rawClaim(tx, f.before, f.claimCommand, { mutate(command, receipt) {
        if (field === "actor") command.actor.id = SELLER.id;
        if (field === "terms") { command.input.terms.principalRaw = "1"; command.input.termsDigest = walletDigest(command.input.terms); }
        if (field === "proof") command.input.claim.proof = null;
        if (field === "principal") command.input.principalHold.expectedTradeReservedRaw = "0";
        if (field === "state basis") command.input.preconditions.walletStateDigest = "f".repeat(64);
        if (field === "private field") (command.input.claim as unknown as Record<string, unknown>).bankAccountNumber = "private";
        command.input.plannerInputDigest = paymentClaimPlannerDigest(command.input, command.actor.id);
        receipt.input = structuredClone(command.input); receipt.actorUserId = command.actor.id; receipt.commandKey = v5CommandKey(command);
        receipt.plannerInputDigest = command.input.plannerInputDigest; receipt.termsDigest = command.input.termsDigest;
        receipt.inputDigest = field === "receipt digest" ? "f".repeat(64) : walletDigest({ actor: command.actor, input: command.input });
      } }))).rejects.toThrow(); expect(await footprint()).toEqual(before);
    }, TIMEOUT);
  it("seals historical tables and new receipt tables against mutation", async () => {
    await buildV5PaymentFixture(store, { dispute: true }); const before = await footprint();
    for (const table of ["commands", "initial_acceptance_receipts", "initial_cancellation_receipts", "payment_engine_continuations", "initial_payment_claim_receipts", "initial_dispute_freeze_receipts"]) {
      await expect(store.transaction(tx => tx.query(`DELETE FROM alpha_wallet_simulation.${table}`))).rejects.toThrow();
    }
    expect(await footprint()).toEqual(before);
  }, TIMEOUT);
  it("refuses old writer factories and standalone use with canonical namespaces", async () => {
    const f = await buildV5PaymentFixture(store, { claim: false }); const before = await footprint();
    await expect(createV4DurableWallet({ mode: MODE, store }).snapshot()).rejects.toThrow();
    await store.transaction(tx => tx.exec("CREATE SCHEMA alpha_wallet_payment_marketplace_simulation"));
    await expect(f.wallet.execute(f.claimCommand)).rejects.toThrow(/canonical/); expect(await footprint()).toEqual(before);
  }, TIMEOUT);
});
