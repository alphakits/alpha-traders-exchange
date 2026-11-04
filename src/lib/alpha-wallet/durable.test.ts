// @vitest-environment node
// Real local PGlite files exercise repository restart/atomicity. Native PostgreSQL
// process crashes and competing database connections are a separate integration gate.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUYER, DISPATCHER, FIXTURE_TIME, OPERATOR, SELLER, TRON, VERIFIER, durableFixture } from "../../../scripts/alpha-wallet/durable-fixtures";
import { assetFor, parseUnits, type AssetId } from "./amounts";
import type { WalletCommand } from "./commands";
import { createDurableWallet, initializeDurableWallet, walletCommand, WalletIntegrityError, type DurableWallet } from "./durable";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { assertLedgerInvariants, balance, expectedCustody } from "./ledger";
import { simulatedDestination } from "./sandbox";
import type { DepositIntent, DepositObservation, Payout, PayoutReceipt } from "./types";

const BSC: AssetId = "bsc-sim-binance-peg-usdt";
const TIMEOUT = 90_000;
let directory: string;
let store: WalletStore;
let wallet: DurableWallet;
let now: number;

async function open() {
  store = await createFileWalletStore({ mode: "simulation-only", dataDir: directory });
  await initializeDurableWallet(store);
  wallet = createDurableWallet({ store, mode: "simulation-only", clock: () => now });
}

async function reopen() {
  await store.close();
  await open();
}

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) {
    vi.stubEnv(key, undefined);
  }
  now = FIXTURE_TIME;
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-repository-"));
  await open();
}, TIMEOUT);

afterEach(async () => {
  try { await store?.close(); }
  finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { vi.unstubAllEnvs(); }
  }
}, TIMEOUT);

function observation(intent: DepositIntent, amount: string, overrides: Partial<DepositObservation> = {}): DepositObservation {
  const asset = assetFor(intent.assetId);
  return { intentId: intent.id, assetId: intent.assetId, network: asset.network, token: asset.token,
    transactionId: `sim-tx-${intent.id}`, eventIndex: 0, destination: intent.destination,
    amountRaw: parseUnits(amount, asset.decimals).toString(), blockHash: "sim-block-original",
    finalized: true, successful: true, ...overrides };
}

function receipt(payout: Payout, overrides: Partial<PayoutReceipt> = {}): PayoutReceipt {
  const asset = assetFor(payout.assetId);
  return { payoutId: payout.id, providerReference: payout.providerReference, assetId: payout.assetId,
    network: asset.network, token: asset.token, transactionId: "sim-tx-payout-final", eventIndex: 0,
    destination: payout.destination, amountRaw: payout.amountRaw.toString(), finalized: true, successful: true, ...overrides };
}

async function counts() {
  return store.transaction(async tx => (await tx.query<{
    commands: number; journals: number; entries: number; intents: number; events: number; claims: number;
  }>(`SELECT
    (SELECT count(*)::int FROM alpha_wallet_simulation.commands) AS commands,
    (SELECT count(*)::int FROM alpha_wallet_simulation.journals) AS journals,
    (SELECT count(*)::int FROM alpha_wallet_simulation.entries) AS entries,
    (SELECT count(*)::int FROM alpha_wallet_simulation.payout_intents) AS intents,
    (SELECT count(*)::int FROM alpha_wallet_simulation.payout_events) AS events,
    (SELECT count(*)::int FROM alpha_wallet_simulation.chain_event_claims) AS claims`)).rows[0]!);
}

/** Faults are confined to this test's temporary database and never use a URL. */
function wrappedStore(backing: WalletStore, wrap: (tx: WalletSql) => WalletSql): WalletStore {
  return { transaction: work => backing.transaction(tx => work(wrap(tx))), close: () => backing.close() };
}

describe("durable simulation repository with real file restarts", () => {
  it("rebuilds the full 500 payout and separate 10 commission state, preserving an older command's event hash", async () => {
    const originalCommand = walletCommand("createDepositIntent", SELLER, "original-request", {
      id: "original-intent", assetId: TRON, purpose: "principal",
    });
    const original = await wallet.execute(originalCommand);
    const fixture = durableFixture(wallet);
    const listingId = await fixture.fundedListing("500", "full-listing");
    const payout = await fixture.queuedTrade("500", listingId, "full-trade");
    expect(payout.amountRaw).toBe(parseUnits("500", 6));
    await fixture.command("beginDispatch", DISPATCHER, payout.id);
    await fixture.command("recordSubmission", DISPATCHER, {
      payoutId: payout.id, outcome: "broadcast", transactionId: "sim-tx-payout-final",
    });
    await fixture.command("confirmPayout", VERIFIER, receipt(payout));
    const completed = (await wallet.snapshot()).state;
    expect(completed.trades.get("full-trade")).toMatchObject({
      status: "completed", amountRaw: parseUnits("500", 6), buyerFeeRaw: parseUnits("5", 6),
      sellerFeeRaw: parseUnits("5", 6), fiatTotalMinor: BigInt(161600),
    });
    expect(completed.commissions.get("full-trade")).toMatchObject({ amountRaw: parseUnits("10", 6), paid: false });
    expect(balance(completed, TRON, `payout:${payout.id}`)).toBe(BigInt(0));
    expect(expectedCustody(completed, TRON)).toBe(BigInt(0));

    await fixture.deposit("10", "commission", "separate-fee-deposit");
    const before = await wallet.snapshot();
    expect(before.state.commissions.get("full-trade")?.paid).toBe(true);
    expect(balance(before.state, TRON, "platform-revenue")).toBe(parseUnits("10", 6));
    expect(balance(before.state, TRON, `available:${SELLER.id}`)).toBe(BigInt(0));
    expect(balance(before.state, TRON, `commission:${SELLER.id}`)).toBe(BigInt(0));
    expect(before.state.receipts.size).toBe(1);
    expect(before.state.evidenceOwners.size).toBe(1);
    expect(before.state.gasReady.has(TRON)).toBe(true);
    expect(before.eventHash).not.toBe(original.eventHash);
    assertLedgerInvariants(before.state);

    // Historical reconciliation checks must use each command's recorded clock.
    now += 120_000;
    await reopen();
    expect(await wallet.snapshot()).toEqual(before);
    const replay = await wallet.execute(originalCommand);
    expect(replay).toEqual({ ...original, replayed: true });
    expect(await wallet.snapshot()).toEqual(before);
    expect(await wallet.recoverPayouts()).toEqual([{ payout: before.state.payouts.get(payout.id), action: "already_confirmed" }]);
  }, TIMEOUT);

  it("preserves exact 18-decimal values beyond Number's range in commands, ledger rows and payout intents", async () => {
    const amount = "9007199254740993.123456789012345678";
    const raw = BigInt("9007199254740993123456789012345678");
    const fixture = durableFixture(wallet, BSC);
    await fixture.deposit(amount);
    await fixture.ready();
    const withdrawal = await fixture.command("requestWithdrawal", SELLER, {
      id: "exact-withdrawal", assetId: BSC, amount, destination: simulatedDestination(BSC, SELLER.id),
      stepUpReference: "sim-stepup-exact",
    });
    expect(withdrawal.result.amountRaw).toBe(raw);
    const before = await wallet.snapshot();
    await reopen();
    const restored = await wallet.snapshot();
    expect(restored).toEqual(before);
    expect(restored.state.payouts.get(withdrawal.result.id)?.amountRaw).toBe(raw);
    expect(balance(restored.state, BSC, `payout:${withdrawal.result.id}`)).toBe(raw);
    expect(expectedCustody(restored.state, BSC)).toBe(raw);
    const stored = await store.transaction(async tx => (await tx.query<{ amount_raw: string }>(
      "SELECT amount_raw::text AS amount_raw FROM alpha_wallet_simulation.payout_intents",
    )).rows);
    expect(stored).toEqual([{ amount_raw: raw.toString() }]);
    assertLedgerInvariants(restored.state);
  }, TIMEOUT);

  it("rolls back a command and every partial projection when a persistence statement fails", async () => {
    const intent = await wallet.execute(walletCommand("createDepositIntent", SELLER, "rollback-intent", {
      id: "rollback-deposit", assetId: TRON, purpose: "principal",
    }));
    const command = walletCommand("observeDeposit", VERIFIER, "rollback-credit", observation(intent.result, "500"));
    const before = await wallet.snapshot();
    const beforeCounts = await counts();
    let entriesAttempted = 0;
    const failureStore = wrappedStore(store, tx => ({
      exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        if (sql.startsWith("INSERT INTO alpha_wallet_simulation.entries") && ++entriesAttempted === 2) {
          // A real PostgreSQL error after command/header/first entry writes.
          await tx.query("SELECT 1 / 0");
        }
        return tx.query<Row>(sql, params);
      },
    }));
    const failing = createDurableWallet({ store: failureStore, mode: "simulation-only", clock: () => now });
    await expect(failing.execute(command)).rejects.toThrow(/division by zero/i);
    expect(entriesAttempted).toBe(2);
    expect(await counts()).toEqual(beforeCounts);
    expect(await wallet.snapshot()).toEqual(before);
    await reopen();
    expect(await wallet.snapshot()).toEqual(before);
    const retry = await wallet.execute(command);
    expect(retry.replayed).toBe(false);
    expect(retry.revision).toBe(before.revision + 1);
    expect(balance((await wallet.snapshot()).state, TRON, `available:${SELLER.id}`)).toBe(parseUnits("500", 6));
    expect(await counts()).toMatchObject({ commands: before.revision + 1, journals: 1, entries: 2, claims: 1 });
  }, TIMEOUT);

  it("reconciles a lost COMMIT acknowledgment to one committed command and one deposit credit after reopening", async () => {
    const intent = await wallet.execute(walletCommand("createDepositIntent", SELLER, "uncertain-intent", {
      id: "uncertain-deposit", assetId: TRON, purpose: "principal",
    }));
    const command = walletCommand("observeDeposit", VERIFIER, "uncertain-credit", observation(intent.result, "500"));
    const backing = store;
    let dropped = false;
    const lostReply: WalletStore = {
      async transaction<T>(work: (tx: WalletSql) => Promise<T>): Promise<T> {
        const committed = await backing.transaction(work);
        if (!dropped) { dropped = true; throw new CommitOutcomeUnknownError(new Error("Fixture dropped the COMMIT reply")); }
        return committed;
      },
      close: () => backing.close(),
    };
    const uncertain = createDurableWallet({ store: lostReply, mode: "simulation-only", clock: () => now });
    await expect(uncertain.execute(command)).rejects.toBeInstanceOf(CommitOutcomeUnknownError);
    await reopen();
    const committed = await wallet.snapshot();
    const recovered = await wallet.execute(command);
    expect(recovered).toMatchObject({ revision: 2, replayed: true, eventHash: committed.eventHash });
    expect(balance(committed.state, TRON, `available:${SELLER.id}`)).toBe(parseUnits("500", 6));
    expect(await wallet.snapshot()).toEqual(committed);
    expect(await counts()).toEqual({ commands: 2, journals: 1, entries: 2, intents: 0, events: 0, claims: 1 });
  }, TIMEOUT);

  it("never reissues a committed dispatch instruction after restart, even if no submission result was saved", async () => {
    const fixture = durableFixture(wallet);
    const payout = await fixture.queuedTrade();
    const claim = walletCommand("beginDispatch", DISPATCHER, "original-dispatch", payout.id);
    const dispatched = await wallet.execute(claim);
    expect(dispatched.result.shouldDispatch).toBe(true);
    const before = await wallet.snapshot();
    await reopen();
    const replay = await wallet.execute(claim);
    expect(replay).toMatchObject({ replayed: true, revision: dispatched.revision, eventHash: dispatched.eventHash,
      result: { shouldDispatch: false, payout: { state: "submitting", dispatchCount: 1, providerReference: payout.providerReference } } });
    await expect(wallet.execute(walletCommand("beginDispatch", DISPATCHER, "another-dispatch", payout.id)))
      .rejects.toThrow(/already dispatched/i);
    expect(await wallet.snapshot()).toEqual(before);
    expect(await wallet.recoverPayouts()).toEqual([{ payout: before.state.payouts.get(payout.id), action: "lookup_original_reference" }]);
  }, TIMEOUT);

  it("recovers unknown submission using the original reference, and persists a matching final receipt exactly once", async () => {
    const fixture = durableFixture(wallet);
    const payout = await fixture.queuedTrade();
    const claim = walletCommand("beginDispatch", DISPATCHER, "unknown-dispatch", payout.id);
    const first = await wallet.execute(claim);
    await fixture.command("recordSubmission", DISPATCHER, { payoutId: payout.id, outcome: "unknown" });
    await reopen();
    const replay = await wallet.execute(claim);
    expect(replay).toMatchObject({ replayed: true, eventHash: first.eventHash,
      result: { shouldDispatch: false, payout: { state: "submission_unknown", dispatchCount: 1, providerReference: payout.providerReference } } });
    expect((await wallet.recoverPayouts())[0]?.action).toBe("lookup_original_reference");
    const received = walletCommand("confirmPayout", VERIFIER, "unknown-resolved", receipt(payout));
    const confirmed = await wallet.execute(received);
    const before = await wallet.snapshot();
    expect(before.state.payouts.get(payout.id)?.state).toBe("confirmed");
    expect(balance(before.state, TRON, `payout:${payout.id}`)).toBe(BigInt(0));
    const beforeCounts = await counts();
    await reopen();
    expect(await wallet.execute(received)).toEqual({ ...confirmed, replayed: true });
    expect((await wallet.execute(claim)).result.shouldDispatch).toBe(false);
    expect(await wallet.snapshot()).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
  }, TIMEOUT);

  it("deduplicates a finalized deposit after restart across repeated and new command identities", async () => {
    const fixture = durableFixture(wallet);
    const { event } = await fixture.deposit("500", "principal", "duplicate-deposit");
    const before = await wallet.snapshot();
    await reopen();
    const duplicate = walletCommand("observeDeposit", VERIFIER, "redelivered-event", event);
    const delivered = await wallet.execute(duplicate);
    expect(delivered.result).toEqual({ credited: false, duplicate: true, halted: false });
    expect((await wallet.execute(duplicate)).replayed).toBe(true);
    const restored = await wallet.snapshot();
    expect(restored.revision).toBe(before.revision + 1);
    expect(restored.state.deposits).toEqual(before.state.deposits);
    expect(restored.state.accounts).toEqual(before.state.accounts);
    expect(restored.state.journal).toEqual(before.state.journal);
    expect(await counts()).toMatchObject({ commands: before.revision + 1, journals: 1, entries: 2, claims: 1 });
  }, TIMEOUT);

  it("persists pending deposit evidence, later finality, and a reorg halt without creating another event claim", async () => {
    const intent = await wallet.execute(walletCommand("createDepositIntent", SELLER, "pending-intent", {
      id: "pending-deposit", assetId: TRON, purpose: "principal",
    }));
    const pending = observation(intent.result, "500", { finalized: false });
    await wallet.execute(walletCommand("observeDeposit", VERIFIER, "pending-observation", pending));
    await reopen();
    expect(expectedCustody((await wallet.snapshot()).state, TRON)).toBe(BigInt(0));
    await wallet.execute(walletCommand("observeDeposit", VERIFIER, "final-observation", { ...pending, finalized: true }));
    await reopen();
    const result = await wallet.execute(walletCommand("observeDeposit", VERIFIER, "reorg-observation", {
      ...pending, blockHash: "sim-block-reorganized",
    }));
    expect(result.result).toEqual({ credited: false, duplicate: true, halted: true });
    const halted = await wallet.snapshot();
    expect(halted.state.haltReason).toMatch(/Finalized deposit evidence changed/);
    expect(expectedCustody(halted.state, TRON)).toBe(parseUnits("500", 6));
    expect(await counts()).toMatchObject({ journals: 1, entries: 2, claims: 1 });
    await reopen();
    expect(await wallet.snapshot()).toEqual(halted);
  }, TIMEOUT);

  it("fails closed on corrupted command history before returning state or accepting another command", async () => {
    await durableFixture(wallet).deposit("500");
    const beforeCounts = await counts();
    // Privileged fault injection into this disposable local fixture. Normal
    // repository operations cannot update immutable commands or disable triggers.
    await store.transaction(async tx => {
      await tx.exec("ALTER TABLE alpha_wallet_simulation.commands DISABLE TRIGGER USER");
      await tx.query(`UPDATE alpha_wallet_simulation.commands
        SET command_json=jsonb_set(command_json, '{input,amountRaw}', $1::jsonb)
        WHERE command_type='observeDeposit'`, [JSON.stringify("999")]);
      await tx.exec("ALTER TABLE alpha_wallet_simulation.commands ENABLE TRIGGER USER");
    });
    await reopen();
    await expect(wallet.snapshot()).rejects.toBeInstanceOf(WalletIntegrityError);
    await expect(wallet.recoverPayouts()).rejects.toThrow(/command identity mismatch/i);
    await expect(wallet.execute(walletCommand("createDepositIntent", SELLER, "after-corruption", {
      id: "after-corruption", assetId: TRON, purpose: "principal",
    }))).rejects.toBeInstanceOf(WalletIntegrityError);
    expect(await counts()).toEqual(beforeCounts);
  }, TIMEOUT);

  it("detects an extra balanced journal that has no corresponding command effect", async () => {
    await durableFixture(wallet).deposit("500");
    // A balanced ledger alone is insufficient: every projection must match
    // independently replayed domain history. Bypass only fixture write guards.
    await store.transaction(async tx => {
      await tx.exec(`ALTER TABLE alpha_wallet_simulation.journals DISABLE TRIGGER USER;
        ALTER TABLE alpha_wallet_simulation.entries DISABLE TRIGGER USER;`);
      await tx.query(`INSERT INTO alpha_wallet_simulation.journals(journal_id,command_revision,asset_id,operation)
        VALUES('unrecorded-journal',2,$1,'unrecorded-operation')`, [TRON]);
      await tx.query(`INSERT INTO alpha_wallet_simulation.entries(journal_id,asset_id,account,delta_units)
        VALUES('unrecorded-journal',$1,'external',-1),('unrecorded-journal',$1,$2,1)`, [TRON, `available:${SELLER.id}`]);
      await tx.exec(`ALTER TABLE alpha_wallet_simulation.journals ENABLE TRIGGER USER;
        ALTER TABLE alpha_wallet_simulation.entries ENABLE TRIGGER USER;`);
    });
    const beforeCounts = await counts();
    await reopen();
    await expect(wallet.snapshot()).rejects.toThrow(/journals disagree with verified command history/i);
    await expect(wallet.execute(walletCommand("pause", OPERATOR, "after-extra-journal", null)))
      .rejects.toBeInstanceOf(WalletIntegrityError);
    expect(await counts()).toEqual(beforeCounts);
  }, TIMEOUT);

  it("rejects wrong fixture roles, malformed envelopes and invalid amounts without appending history", async () => {
    const fixture = durableFixture(wallet);
    const listingId = await fixture.fundedListing();
    const before = await wallet.snapshot();
    const beforeCounts = await counts();
    await expect(wallet.execute(walletCommand("approveListing", BUYER, "buyer-approval", listingId)))
      .rejects.toThrow(/Requires operator authority/);
    const valid = walletCommand("createDepositIntent", SELLER, "invalid-envelope", {
      id: "new-intent", assetId: TRON, purpose: "principal",
    });
    await expect(wallet.execute({ ...valid, unexpected: true } as unknown as WalletCommand)).rejects.toThrow();
    await expect(wallet.execute({ ...valid, engineVersion: "unknown-engine" } as unknown as WalletCommand)).rejects.toThrow();
    await expect(wallet.execute(walletCommand("reserveTrade", BUYER, "fractional-trade", {
      id: "invalid-trade", listingId, amount: "1.0000001", destination: simulatedDestination(TRON, BUYER.id),
    }))).rejects.toThrow(/precision/);
    expect(await wallet.snapshot()).toEqual(before);
    expect(await counts()).toEqual(beforeCounts);
    await reopen();
    expect(await wallet.snapshot()).toEqual(before);
  }, TIMEOUT);

  it("rejects a changed payload under a previously committed identity after restart", async () => {
    const command = walletCommand("createDepositIntent", SELLER, "stable-identity", {
      id: "first-intent", assetId: TRON, purpose: "principal",
    });
    await wallet.execute(command);
    const before = await wallet.snapshot();
    await reopen();
    await expect(wallet.execute({ ...command, input: { ...command.input, id: "changed-intent" } }))
      .rejects.toThrow(/Idempotency key reused with different payload/);
    expect(await wallet.snapshot()).toEqual(before);
    expect((await counts()).commands).toBe(1);
  }, TIMEOUT);

  it("serializes competing repository instances so two 300 reservations cannot oversell a 500 listing", async () => {
    const fixture = durableFixture(wallet);
    const listingId = await fixture.fundedListing("500", "contended-listing");
    const before = await wallet.snapshot();
    // Both repositories share the sole open file transport. This is deliberately
    // not a claim of cross-process locking; that requires the native PG suite.
    const competitor = createDurableWallet({ store, mode: "simulation-only", clock: () => now });
    const first = walletCommand("reserveTrade", BUYER, "reservation-a", {
      id: "trade-a", listingId, amount: "300", destination: simulatedDestination(TRON, BUYER.id),
    });
    const second = walletCommand("reserveTrade", { kind: "buyer", id: "buyer-b" }, "reservation-b", {
      id: "trade-b", listingId, amount: "300", destination: simulatedDestination(TRON, "buyer-b"),
    });
    const outcomes = await Promise.allSettled([wallet.execute(first), competitor.execute(second)]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const failure = outcomes.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(Error);
    expect(failure.reason.message).toMatch(/Insufficient funds/);
    const after = await wallet.snapshot();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.state.trades.size).toBe(1);
    expect(balance(after.state, TRON, `listing:${listingId}`)).toBe(parseUnits("200", 6));
    expect([...after.state.trades.values()][0]?.amountRaw).toBe(parseUnits("300", 6));
    assertLedgerInvariants(after.state);
    await reopen();
    expect(await wallet.snapshot()).toEqual(after);
  }, TIMEOUT);

  it("collapses concurrent copies of the same request into one committed command", async () => {
    const command = walletCommand("createDepositIntent", SELLER, "concurrent-request", {
      id: "one-intent", assetId: TRON, purpose: "principal",
    });
    const results = await Promise.all(Array.from({ length: 5 }, () => wallet.execute(command)));
    expect(results.filter(result => !result.replayed)).toHaveLength(1);
    expect(new Set(results.map(result => result.eventHash)).size).toBe(1);
    expect(results.map(result => result.revision)).toEqual([1, 1, 1, 1, 1]);
    expect((await counts()).commands).toBe(1);
    await reopen();
    expect((await wallet.snapshot()).state.depositIntents.size).toBe(1);
    expect((await wallet.execute(command)).replayed).toBe(true);
  }, TIMEOUT);

  it("replays historical readiness at recorded time while rejecting a newly dispatched stale reconciliation", async () => {
    const payout = await durableFixture(wallet).queuedTrade();
    const before = await wallet.snapshot();
    now += 60_001;
    await reopen();
    expect(await wallet.snapshot()).toEqual(before);
    await expect(wallet.execute(walletCommand("beginDispatch", DISPATCHER, "stale-dispatch", payout.id)))
      .rejects.toThrow(/Fresh matching custody reconciliation required/);
    expect(await wallet.snapshot()).toEqual(before);
    expect((await counts()).commands).toBe(before.revision);
  }, TIMEOUT);
});
