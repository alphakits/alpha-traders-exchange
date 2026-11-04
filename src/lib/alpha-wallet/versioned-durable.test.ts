// @vitest-environment node
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUYER, DISPATCHER, FIXTURE_TIME, OPERATOR, SELLER, TRON, durableFixture } from "../../../scripts/alpha-wallet/durable-fixtures";
import { planAcceptedAmountTerms } from "./accepted-terms";
import { parseUnits } from "./amounts";
import { walletDigest, walletJson, WALLET_ENGINE_VERSION } from "./commands";
import { createDurableWallet, initializeDurableWallet, verifyDurableHistory, walletCommand } from "./durable";
import { createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { balance, expectedCustody } from "./ledger";
import { simulatedDestination } from "./sandbox";
import { acceptanceInputFromPlan, v2Command, versionedCommandKey, WALLET_V2_ENGINE_VERSION, type V2Command, type VersionedCommand } from "./v2-commands";
import { applyV2Command, isV2State, planningBindingFor } from "./v2-engine";
import { createV2TermsFixture } from "./v2-fixtures";
import { createVersionedDurableWallet, upgradeDurableWalletV2, verifyVersionedHistory, type VersionedWalletSnapshot } from "./versioned-durable";
import { versionedProjectionDelta, writeVersionedProjection, type VersionedProjection } from "./versioned-projections";

const TIMEOUT = 120_000;
const MODE = "simulation-only" as const;
const LISTING = "durable-v2-listing", TRADE = "durable-v2-trade", REQUEST = "durable-v2-request";
const MIGRATION = readFileSync(new URL("../../../docs/alpha-wallet/durable-v2-migration.sql", import.meta.url), "utf8");
const COMMAND_ROWS = `SELECT revision,command_key,command_type,occurred_at_ms::text AS occurred_at_ms,
  command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
  FROM alpha_wallet_simulation.commands ORDER BY revision`;
let directory: string, dataDir: string, now: number, store: WalletStore;
let v1: ReturnType<typeof createDurableWallet>, wallet: ReturnType<typeof createVersionedDurableWallet>;
const clock = () => ++now;

function wallets() {
  v1 = createDurableWallet({ mode: MODE, store, clock });
  wallet = createVersionedDurableWallet({ mode: MODE, store, clock });
}
beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
  now = FIXTURE_TIME;
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-versioned-durable-"));
  dataDir = join(directory, "wallet");
  store = await createFileWalletStore({ mode: MODE, dataDir });
  await initializeDurableWallet(store);
  wallets();
}, TIMEOUT);
afterEach(async () => {
  try { await store?.close(); }
  finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { vi.unstubAllEnvs(); }
  }
}, TIMEOUT);

const checkpoint = (snapshot: VersionedWalletSnapshot) => ({ revision: snapshot.revision, eventHash: snapshot.eventHash,
  stateHash: walletDigest(snapshot.state), lastCommandAtMs: snapshot.lastCommandAtMs });
const bound = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });
async function rows() { return store.transaction(async tx => (await tx.query(COMMAND_ROWS)).rows); }
async function layout() {
  return store.transaction(async tx => ({
    head: (await tx.query("SELECT revision,last_event_hash,format_version FROM alpha_wallet_simulation.head")).rows,
    tables: (await tx.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='alpha_wallet_simulation' AND c.relkind='r' ORDER BY c.relname`)).rows,
    commands: (await tx.query(COMMAND_ROWS)).rows,
    journals: (await tx.query("SELECT journal_id,command_revision,asset_id,operation FROM alpha_wallet_simulation.journals ORDER BY journal_id")).rows,
    entries: (await tx.query("SELECT journal_id,asset_id,account,delta_units::text FROM alpha_wallet_simulation.entries ORDER BY journal_id,account")).rows,
  }));
}
async function seed() {
  const fixture = durableFixture(v1);
  await fixture.fundedListing("500", LISTING);
  const reserve = walletCommand("reserveTrade", BUYER, "durable-v1-reserve", {
    id: TRADE, listingId: LISTING, amount: "200", destination: simulatedDestination(TRON, BUYER.id),
  });
  const reserved = await v1.execute(reserve);
  return { fixture, reserve, reserved };
}
async function upgrade(requestId = "durable-v2-upgrade") {
  const before = await wallet.snapshot();
  const command = v2Command("continueFromV1", OPERATOR, requestId, { checkpoint: checkpoint(before) });
  const result = await upgradeDurableWalletV2({ mode: MODE, store, command, acknowledgeVersionUpgrade: true, clock });
  return { command, before, result };
}
async function enroll() {
  const before = await wallet.snapshot();
  const fixture = createV2TermsFixture({ mode: MODE, state: before.state, walletTradeId: TRADE, platformRequestId: REQUEST });
  const command = v2Command("enrollReservedTrade", OPERATOR, "durable-v2-enroll", { walletTradeId: TRADE,
    terms: fixture.description.terms, termsDigest: fixture.description.digest, expectedWallet: checkpoint(before),
    walletTradeDigest: walletDigest(before.state.trades.get(TRADE)) });
  return { command, result: await wallet.execute(command) };
}
async function planned(amount = "300", proposalId = "durable-v2-proposal-one", submittedAdjustmentCount: 1 | 2 = 1) {
  const before = await wallet.snapshot();
  if (!isV2State(before.state)) throw new Error("Fixture requires v2 state");
  const fixture = createV2TermsFixture({ mode: MODE, state: before.state, walletTradeId: TRADE, platformRequestId: REQUEST,
    proposedAmount: amount, proposalId, submittedAdjustmentCount });
  const binding = planningBindingFor(before.state, REQUEST);
  const plan = planAcceptedAmountTerms({ mode: MODE, actorUserId: BUYER.id, requestId: REQUEST, proposalId,
    expectedBindingRevision: binding.revision, marketplace: fixture.marketplace, wallet: before, binding });
  const command = v2Command("acceptAmountCorrection", BUYER, `transport-${proposalId}`, acceptanceInputFromPlan(plan));
  return { before, command };
}
async function acquire(tx: WalletSql) {
  await tx.query("SELECT set_config('alpha_wallet.writer_protocol', 'simulation-v2', true)");
  await tx.query("UPDATE alpha_wallet_simulation.head SET lock_version=lock_version+1 WHERE singleton=true");
}

/** Deliberately bypass repository verification to exercise independent SQL guards. */
async function insertCommand(tx: WalletSql, before: VersionedWalletSnapshot, command: VersionedCommand,
  result: unknown = null, state = before.state) {
  const revision = before.revision + 1, at = before.lastCommandAtMs + 1, commandKey = versionedCommandKey(command);
  const inputHash = walletDigest(command), resultHash = walletDigest(result), stateHash = walletDigest(state);
  const eventHash = walletDigest({ revision, commandKey, at, inputHash, resultHash, stateHash, previousHash: before.eventHash });
  await tx.query(`INSERT INTO alpha_wallet_simulation.commands(revision,command_key,command_type,occurred_at_ms,command_json,input_hash,
    result_json,result_hash,state_hash,previous_event_hash,event_hash) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9,$10,$11)`,
  [revision, commandKey, command.type, at, JSON.stringify(command), inputHash, JSON.stringify(walletJson(result)), resultHash, stateHash, before.eventHash, eventHash]);
  return { revision, eventHash };
}
async function rawAcceptance(before: VersionedWalletSnapshot, command: V2Command,
  change: (delta: VersionedProjection) => void = () => undefined, late?: (tx: WalletSql, revision: number) => Promise<void>) {
  return store.transaction(async tx => {
    await acquire(tx);
    const applied = applyV2Command(before.state, command, { ...checkpoint(before), at: before.lastCommandAtMs + 1 });
    const event = await insertCommand(tx, before, command, applied.result, applied.state);
    const delta = versionedProjectionDelta(before.state, applied.state, event.revision);
    change(delta);
    await writeVersionedProjection(tx, delta);
    await tx.query("UPDATE alpha_wallet_simulation.head SET revision=$1,last_event_hash=$2 WHERE singleton=true", [event.revision, event.eventHash]);
    if (late) await late(tx, event.revision);
  });
}

describe("versioned durable wallet and explicit atomic migration", () => {
  it("replays frozen v1 evidence exactly and never upgrades a read or the original initializer", async () => {
    const frozen = JSON.parse(readFileSync(new URL("./fixtures/v1/settlement-and-held-withdrawal.backup.json", import.meta.url), "utf8"));
    const old = verifyDurableHistory(frozen.commands), versioned = verifyVersionedHistory(frozen.commands);
    expect(versioned).toEqual({ ...old, lastCommandAtMs: old.occurredAtMs, engineVersion: WALLET_ENGINE_VERSION });
    await seed();
    const before = await layout(), original = await v1.snapshot(), snapshot = await wallet.snapshot();
    expect(snapshot).toMatchObject({ ...original, engineVersion: WALLET_ENGINE_VERSION });
    await initializeDurableWallet(store);
    expect(await layout()).toEqual(before);
    expect(before.tables.some(row => row.relname === "engine_continuations")).toBe(false);
  }, TIMEOUT);

  it("atomically continues the existing hash chain, preserves every v1 row, and reopens with one transition", async () => {
    await seed();
    const originalRows = await rows(), beforeLayout = await layout();
    const { before, command, result } = await upgrade();
    const snapshot = await wallet.snapshot();
    expect(snapshot.engineVersion).toBe(WALLET_V2_ENGINE_VERSION);
    expect(snapshot.revision).toBe(before.revision + 1);
    expect(snapshot.state.journal).toEqual(before.state.journal);
    expect(snapshot.state.accounts).toEqual(before.state.accounts);
    expect((await rows()).slice(0, originalRows.length)).toEqual(originalRows);
    expect((await rows()).at(-1)).toMatchObject({ previous_event_hash: before.eventHash, command_json: command,
      revision: before.revision + 1, event_hash: result.eventHash });
    expect((await layout()).entries).toEqual(beforeLayout.entries);
    expect((await layout()).head).toEqual([{ revision: snapshot.revision, last_event_hash: snapshot.eventHash, format_version: 2 }]);
    expect(await upgradeDurableWalletV2({ mode: MODE, store, command, acknowledgeVersionUpgrade: true, clock }))
      .toEqual({ ...result, replayed: true });
    expect(await wallet.execute(command)).toEqual({ ...result, replayed: true });
    await expect(upgrade("different-upgrade-identity")).rejects.toThrow(/already continued/);
    await expect(initializeDurableWallet(store)).rejects.toThrow(/Unsupported durable/);
    await expect(v1.snapshot()).rejects.toThrow(/simulation-v2 writer protocol/);
    await store.close();
    store = await createFileWalletStore({ mode: MODE, dataDir });
    wallets();
    expect(await wallet.snapshot()).toEqual(snapshot);
    expect(verifyVersionedHistory(await rows())).toEqual(snapshot);
  }, TIMEOUT);

  it("rejects wrong checkpoints, actors, missing acknowledgment and implicit continuation before DDL", async () => {
    await seed();
    const before = await wallet.snapshot(), beforeLayout = await layout();
    const command = v2Command("continueFromV1", OPERATOR, "explicit-required", { checkpoint: checkpoint(before) });
    await expect(wallet.execute(command)).rejects.toThrow(/explicit upgradeDurableWalletV2/);
    await expect(upgradeDurableWalletV2({ mode: MODE, store, command, acknowledgeVersionUpgrade: false as true, clock }))
      .rejects.toThrow(/acknowledgment/);
    await expect(upgradeDurableWalletV2({ mode: MODE, store, command: { ...command, actor: BUYER }, acknowledgeVersionUpgrade: true, clock }))
      .rejects.toThrow(/operator/i);
    const stale = structuredClone(command);
    stale.input.checkpoint.stateHash = "f".repeat(64);
    await expect(upgradeDurableWalletV2({ mode: MODE, store, command: stale, acknowledgeVersionUpgrade: true, clock }))
      .rejects.toThrow(/checkpoint/i);
    expect(await layout()).toEqual(beforeLayout);
    expect(await wallet.snapshot()).toEqual(before);
  }, TIMEOUT);

  it("poisons a certified outer transaction when its caller swallows a semantic failure after migration writes", async () => {
    await seed();
    const before = await wallet.snapshot(), beforeLayout = await layout();
    const command = v2Command("continueFromV1", OPERATOR, "swallowed-upgrade", { checkpoint: checkpoint(before) });
    const failure = new Error("Fixture semantic failure after migration and continuation append");
    let migrated = false, inserted = false, captured: unknown;
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
      try { await upgradeDurableWalletV2({ mode: MODE, store: bound(wrapped), command, acknowledgeVersionUpgrade: true, clock }); }
      catch (error) { captured = error; }
      // A broken coordinator has intentionally swallowed the participant error.
    })).rejects.toThrow(/division by zero|aborted/i);
    expect(captured).toBe(failure);
    expect(migrated && inserted).toBe(true);
    expect(await layout()).toEqual(beforeLayout);
    expect(await v1.snapshot()).toMatchObject({ revision: before.revision, eventHash: before.eventHash, state: before.state });
  }, TIMEOUT);

  it("rejects a schema-only migration at commit and rolls all DDL back independently of the repository", async () => {
    await seed();
    const before = await wallet.snapshot(), beforeLayout = await layout();
    const command = v2Command("continueFromV1", OPERATOR, "raw-schema-only", { checkpoint: checkpoint(before) });
    await expect(store.transaction(async tx => {
      await acquire(tx);
      await tx.exec("SET CONSTRAINTS ALL IMMEDIATE");
      await tx.exec("SET CONSTRAINTS ALL DEFERRED");
      await tx.query("SELECT set_config('alpha_wallet.schema_upgrade', 'v1-to-v2', true)");
      await tx.query("SELECT set_config('alpha_wallet.v2_upgrade_command', $1, true)", [JSON.stringify(command)]);
      await tx.query("SELECT set_config('alpha_wallet.v2_upgrade_key', $1, true)", [versionedCommandKey(command)]);
      await tx.exec(MIGRATION);
    })).rejects.toThrow(/foreign key|atomically/i);
    expect(await layout()).toEqual(beforeLayout);
    await expect(v1.snapshot()).resolves.toMatchObject({ revision: before.revision, eventHash: before.eventHash });
  }, TIMEOUT);

  it("never poisons an uncertified or changed transaction identity", async () => {
    const failure = new Error("Fixture participant failed after its write gate");
    for (const identities of [["41", "42"], ["41", "41", "42"]]) {
      const queries: string[] = [];
      let read = 0;
      const tx: WalletSql = {
        exec: async () => { throw new Error("Unexpected migration in identity fixture"); },
        async query<Row extends Record<string, unknown>>(sql: string) {
          queries.push(sql);
          if (sql.includes("txid_current()")) return { rows: [{ transaction_id: identities[read++],
            isolation: "serializable", read_only: "off", development_mode: MODE }] as unknown as Row[] };
          if (sql.startsWith("SELECT set_config")) return { rows: [] as Row[] };
          if (sql.startsWith("UPDATE alpha_wallet_simulation.head")) throw failure;
          throw new Error("Unexpected query in identity fixture");
        },
      };
      const operation = createVersionedDurableWallet({ mode: MODE, store: bound(tx), clock }).snapshot();
      if (identities.length === 2) await expect(operation).rejects.toThrow(/identity changed or ended/);
      else await expect(operation).rejects.toBe(failure);
      expect(queries.some(sql => sql.includes("SELECT 1 / 0"))).toBe(false);
      if (identities.length === 2) expect(queries.some(sql => sql.startsWith("UPDATE"))).toBe(false);
    }
  }, TIMEOUT);

  it("resizes the same reserved trade in both directions and preserves original historical results and global command identities", async () => {
    const { reserve, reserved } = await seed();
    await upgrade();
    await enroll();
    const first = await planned("300");
    const accepted = await wallet.execute(first.command);
    expect(accepted.result).toMatchObject({ principalDeltaRaw: parseUnits("100", 6).toString(), bindingRevision: 1 });
    expect(await wallet.execute(reserve)).toEqual({ ...reserved, replayed: true });
    const changedEngine = v2Command("reserveTrade", reserve.actor, reserve.requestId, reserve.input);
    await expect(wallet.execute(changedEngine)).rejects.toThrow(/different payload or engine version/);
    await expect(wallet.execute(walletCommand("pause", OPERATOR, "legacy-after-upgrade", null))).rejects.toThrow(/v1 commands are fenced/);
    const second = await planned("150", "durable-v2-proposal-two", 2);
    const lowered = await wallet.execute(second.command);
    expect(lowered.result).toMatchObject({ principalDeltaRaw: (-parseUnits("150", 6)).toString(), bindingRevision: 2 });
    const snapshot = await wallet.snapshot();
    expect(snapshot.state.trades.size).toBe(1);
    expect(snapshot.state.trades.get(TRADE)).toMatchObject({ id: TRADE, amountRaw: parseUnits("150", 6), status: "reserved" });
    expect(balance(snapshot.state, TRON, `listing:${LISTING}`)).toBe(parseUnits("350", 6));
    expect(balance(snapshot.state, TRON, `trade:${TRADE}`)).toBe(parseUnits("150", 6));
    expect(expectedCustody(snapshot.state, TRON)).toBe(parseUnits("500", 6));
    if (!isV2State(snapshot.state)) throw new Error("Expected v2 state");
    expect(snapshot.state.termsBindings.get(REQUEST)?.revision).toBe(2);
    expect(snapshot.state.acceptanceReceipts.size).toBe(2);
    const history = await rows();
    expect(verifyVersionedHistory(history)).toEqual(snapshot);
    await store.close();
    store = await createFileWalletStore({ mode: MODE, dataDir });
    wallets();
    expect(await wallet.snapshot()).toEqual(snapshot);
  }, TIMEOUT);

  it("returns the immutable receipt across concurrent transport identities and later trade progress without another append", async () => {
    await seed(); await upgrade(); await enroll();
    const { command } = await planned("200");
    const before = await wallet.snapshot(), journals = before.state.journal.length;
    const responses = await Promise.all([wallet.execute(command), wallet.execute({ ...command, requestId: "other-transport" })]);
    expect(responses.map(item => item.replayed).sort()).toEqual([false, true]);
    expect(new Set(responses.map(item => item.eventHash)).size).toBe(1);
    expect(new Set(responses.map(item => item.commandKey)).size).toBe(1);
    expect((await wallet.snapshot()).revision).toBe(before.revision + 1);
    expect((await wallet.snapshot()).state.journal.length).toBe(journals);
    await wallet.execute(v2Command("markBuyerPaid", BUYER, "progress-after-acceptance", TRADE));
    const progressed = await wallet.snapshot(), original = responses.find(item => !item.replayed)!;
    expect(await wallet.execute({ ...command, requestId: "third-transport" })).toEqual({ ...original, replayed: true });
    await expect(wallet.execute({ ...command, requestId: "changed-actor", actor: { ...BUYER, id: "another-buyer" } })).rejects.toThrow();
    await expect(wallet.execute({ ...command, requestId: "changed-descriptor", input: { ...command.input, plannerInputDigest: "f".repeat(64) } })).rejects.toThrow();
    expect(await wallet.snapshot()).toEqual(progressed);
    expect((await rows()).filter(row => row.command_type === "acceptAmountCorrection")).toHaveLength(1);
  }, TIMEOUT);

  it("keeps historical dispatch retries non-authorizing with the current inherited payout state", async () => {
    const fixture = durableFixture(v1);
    await fixture.deposit("100"); await fixture.ready();
    const payout = (await fixture.command("requestWithdrawal", SELLER, { id: "v1-held-withdrawal", assetId: TRON, amount: "25",
      destination: simulatedDestination(TRON, SELLER.id), stepUpReference: "sim-stepup-v2-held" })).result;
    const dispatch = walletCommand("beginDispatch", DISPATCHER, "v1-historical-dispatch", payout.id);
    expect((await v1.execute(dispatch)).result.shouldDispatch).toBe(true);
    await fixture.command("recordSubmission", DISPATCHER, { payoutId: payout.id, outcome: "unknown" });
    await upgrade();
    const replay = await wallet.execute(dispatch);
    expect(replay.result).toMatchObject({ shouldDispatch: false, payout: { state: "submission_unknown", dispatchCount: 1 } });
    await wallet.execute(v2Command("recordSubmission", DISPATCHER, "v2-recovered-submission", {
      payoutId: payout.id, outcome: "broadcast", transactionId: "sim-tx-v2-recovered" }));
    expect((await wallet.execute(dispatch)).result).toMatchObject({ shouldDispatch: false, payout: { state: "broadcast", dispatchCount: 1 } });
    expect((await wallet.recoverPayouts()).find(item => item.payout.id === payout.id)?.action).toBe("lookup_original_reference");
  }, TIMEOUT);

  it("fences old SQL writers, engine spoofing, a repeated transition and format downgrades at database boundaries", async () => {
    await seed(); await upgrade();
    const before = await wallet.snapshot(), beforeLayout = await layout();
    await expect(store.transaction(async tx => {
      await tx.query("UPDATE alpha_wallet_simulation.head SET lock_version=lock_version+1 WHERE singleton=true");
    })).rejects.toThrow(/simulation-v2 writer protocol/);
    const envelopes: VersionedCommand[] = [
      walletCommand("pause", OPERATOR, "old-direct-writer", null),
      { ...v2Command("pause", OPERATOR, "unknown-direct-engine", null), engineVersion: "unknown-engine" } as unknown as V2Command,
      { ...v2Command("pause", OPERATOR, "extra-direct-envelope", null), extra: "unreviewed" } as unknown as V2Command,
      { ...v2Command("pause", OPERATOR, "extra-direct-actor", null), actor: { ...OPERATOR, extra: "unreviewed" } } as unknown as V2Command,
      { ...v2Command("pause", OPERATOR, "null-direct-authority", null), actor: { ...OPERATOR, kind: null } } as unknown as V2Command,
      v2Command("continueFromV1", OPERATOR, "repeat-direct-continuation", { checkpoint: checkpoint(before) }),
    ];
    for (const command of envelopes) await expect(store.transaction(async tx => {
      await acquire(tx); await insertCommand(tx, before, command);
    })).rejects.toThrow(/unknown engines|legacy appends|cannot repeat/);
    await expect(store.transaction(async tx => {
      await acquire(tx);
      await tx.query("UPDATE alpha_wallet_simulation.head SET format_version=1 WHERE singleton=true");
    })).rejects.toThrow(/version may advance only/);
    expect(await layout()).toEqual(beforeLayout);
  }, TIMEOUT);

  it("independently rejects missing acceptance receipts and balanced but incorrect resize deltas at commit", async () => {
    await seed(); await upgrade(); await enroll();
    const { before, command } = await planned("300");
    const saved = await layout();
    await expect(rawAcceptance(before, command, delta => { delta.acceptances = []; }))
      .rejects.toThrow(/durable receipt must commit together/);
    expect(await layout()).toEqual(saved);
    await expect(rawAcceptance(before, command, delta => {
      for (const entry of delta.entries) entry.delta_units = (BigInt(String(entry.delta_units)) / BigInt(2)).toString();
    })).rejects.toThrow(/agreed delta/);
    expect(await layout()).toEqual(saved);
    expect(await wallet.snapshot()).toEqual(before);
  }, TIMEOUT);

  it("checks late journal inserts after deferred constraints were flushed for a zero-delta acceptance", async () => {
    await seed(); await upgrade(); await enroll();
    const { before, command } = await planned("200");
    const saved = await layout();
    await expect(rawAcceptance(before, command, undefined, async (tx, revision) => {
      await tx.exec("SET CONSTRAINTS ALL IMMEDIATE");
      // Journal balance checking normally waits while its two entries are
      // assembled. Keep the versioned metadata check immediate after its flush.
      await tx.exec("SET CONSTRAINTS alpha_wallet_simulation.financial_integrity DEFERRED");
      await tx.query(`INSERT INTO alpha_wallet_simulation.journals(journal_id,command_revision,asset_id,operation)
        VALUES('late-invented-journal',$1,$2,'fixture-invalid-late-insert')`, [revision, TRON]);
    })).rejects.toThrow(/Zero-delta acceptance cannot create a journal/);
    expect(await layout()).toEqual(saved);
  }, TIMEOUT);

  it("rejects internally consistent SQL attempts to redirect locked terms or forge the acceptance receipt delta", async () => {
    await seed(); await upgrade(); await enroll();
    const { before, command } = await planned("300");
    const saved = await layout();
    for (const tamper of ["destination", "receipt-delta", "receipt-terms"] as const) {
      await expect(store.transaction(async tx => {
        await acquire(tx);
        const applied = applyV2Command(before.state, command, { ...checkpoint(before), at: before.lastCommandAtMs + 1 });
        const forgedCommand = structuredClone(command), result = structuredClone(applied.result) as Record<string, unknown>;
        const delta = versionedProjectionDelta(before.state, applied.state, before.revision + 1);
        if (tamper === "destination") {
          forgedCommand.input.acceptedTerms.destination = simulatedDestination(TRON, "diverted-buyer");
          const terms = forgedCommand.input.acceptedTerms, digest = walletDigest(terms);
          forgedCommand.input.plannerInputDigest = walletDigest({ actorUserId: BUYER.id, prior: command.input.priorTermsDigest,
            accepted: digest, preconditions: command.input.preconditions });
          Object.assign(result, { terms, acceptedTermsDigest: digest, plannerInputDigest: forgedCommand.input.plannerInputDigest,
            inputDigest: walletDigest({ actor: forgedCommand.actor, input: forgedCommand.input }) });
          Object.assign(delta.terms[0]!.payload as Record<string, unknown>, { terms, termsDigest: digest });
        } else if (tamper === "receipt-delta") {
          result.principalDeltaRaw = "0"; result.transferAmountRaw = "0";
        } else {
          (result.terms as Record<string, unknown>).destination = simulatedDestination(TRON, "diverted-receipt");
        }
        delta.acceptances[0]!.payload = walletJson(result);
        const event = await insertCommand(tx, before, forgedCommand, result, applied.state);
        await writeVersionedProjection(tx, delta);
        await tx.query("UPDATE alpha_wallet_simulation.head SET revision=$1,last_event_hash=$2 WHERE singleton=true", [event.revision, event.eventHash]);
      })).rejects.toThrow(tamper === "destination" ? /same enrolled trade/ : tamper === "receipt-delta" ? /exact signed and absolute/ : /immutable result of its exact command/);
      expect(await layout()).toEqual(saved);
    }
  }, TIMEOUT);

  it("keeps new projections immutable, checks reads against replay and leaves every new object default-deny", async () => {
    await seed(); await upgrade(); await enroll();
    const accepted = await planned(); await wallet.execute(accepted.command);
    const before = await wallet.snapshot();
    for (const statement of [
      "UPDATE alpha_wallet_simulation.engine_continuations SET source_revision=source_revision",
      "DELETE FROM alpha_wallet_simulation.trade_terms_events",
      "TRUNCATE alpha_wallet_simulation.acceptance_receipts",
    ]) await expect(store.transaction(async tx => { await acquire(tx); await tx.exec(statement); })).rejects.toThrow(/immutable|append.only/i);
    const corrupt: WalletStore = { close: async () => undefined, transaction: work => store.transaction(tx => work({
      exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const answer = await tx.query<Row>(sql, params);
        if (sql.startsWith("SELECT acceptance_key,")) {
          const forged = structuredClone(answer.rows) as Array<Record<string, unknown>>;
          (forged[0]!.payload as Record<string, unknown>).principalDeltaRaw = "0";
          return { rows: forged as Row[] };
        }
        return answer;
      },
    })) };
    await expect(createVersionedDurableWallet({ mode: MODE, store: corrupt, clock }).snapshot()).rejects.toThrow(/acceptances disagree/);
    const privileges = await store.transaction(async tx => {
      await tx.exec("CREATE ROLE v2_storage_unprivileged NOLOGIN");
      return (await tx.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
        has_table_privilege('v2_storage_unprivileged', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS client_access
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='alpha_wallet_simulation' AND c.relname IN ('engine_continuations','trade_terms_events','acceptance_receipts') ORDER BY c.relname`)).rows;
    });
    expect(privileges).toHaveLength(3);
    for (const row of privileges) expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true, client_access: false });
    const functions = await store.transaction(async tx => (await tx.query(`SELECT p.proname,p.prosecdef,
      has_function_privilege('v2_storage_unprivileged',p.oid,'EXECUTE') AS client_access
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='alpha_wallet_simulation'`)).rows);
    for (const row of functions) expect(row).toMatchObject({ prosecdef: false, client_access: false });
    expect(await wallet.snapshot()).toEqual(before);
  }, TIMEOUT);
});
