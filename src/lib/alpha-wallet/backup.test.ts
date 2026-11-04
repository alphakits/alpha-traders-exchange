// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISPATCHER, FIXTURE_TIME, OPERATOR, SELLER, TRON, VERIFIER, durableFixture } from "../../../scripts/alpha-wallet/durable-fixtures";
import { parseUnits, type AssetId } from "./amounts";
import { exportWalletBackup, inspectWalletBackup, restoreWalletBackup } from "./backup";
import { walletDigest } from "./commands";
import { createDurableWallet, initializeDurableWallet, walletCommand } from "./durable";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { createFileFakeProvider, type FileFakeProvider } from "./fake-provider";
import { assertLedgerInvariants, balance, expectedCustody } from "./ledger";
import { createSimulationPayoutWorker } from "./payout-worker";
import { simulatedDestination } from "./sandbox";
import type { Payout } from "./types";

const TIMEOUT = 120_000;
const BSC: AssetId = "bsc-sim-binance-peg-usdt";
const stores: WalletStore[] = [];
let directory: string;

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(key, undefined);
  directory = await mkdtemp(join(tmpdir(), "alpha-wallet-backup-"));
}, TIMEOUT);
afterEach(async () => {
  try { await Promise.allSettled(stores.splice(0).map(store => store.close())); }
  finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { vi.unstubAllEnvs(); }
  }
}, TIMEOUT);

async function connected(name: string, initialize = true, clock = () => FIXTURE_TIME) {
  const dataDir = join(directory, name);
  const store = await createFileWalletStore({ mode: "simulation-only", dataDir });
  stores.push(store);
  if (initialize) await initializeDurableWallet(store);
  const wallet = createDurableWallet({ store, mode: "simulation-only", clock });
  return { store, wallet, dataDir, fixture: durableFixture(wallet) };
}
function backup(store: WalletStore, at = FIXTURE_TIME) {
  return exportWalletBackup({ mode: "simulation-only", store, clock: () => at });
}
function restore(store: WalletStore, serialized: string, at = FIXTURE_TIME + 1_000) {
  return restoreWalletBackup({ mode: "simulation-only", store, backup: serialized, acknowledgeFreshTarget: true, clock: () => at });
}
async function rows(store: WalletStore) {
  return store.transaction(async tx => (await tx.query(`SELECT revision,command_key,command_type,
    occurred_at_ms::text AS occurred_at_ms,command_json,input_hash,result_json,result_hash,state_hash,previous_event_hash,event_hash
    FROM alpha_wallet_simulation.commands ORDER BY revision`)).rows);
}
function wrapped(backing: WalletStore, make: (tx: WalletSql) => WalletSql): WalletStore {
  return { transaction: work => backing.transaction(tx => work(make(tx))), close: () => backing.close() };
}
async function queuedWithdrawal(context: Awaited<ReturnType<typeof connected>>) {
  await context.fixture.deposit("500");
  await context.fixture.ready();
  return (await context.fixture.command("requestWithdrawal", SELLER, {
    id: "restore-withdrawal", assetId: TRON, amount: "200", destination: simulatedDestination(TRON, SELLER.id), stepUpReference: "sim-stepup-recovery",
  })).result;
}
function watched(provider: FileFakeProvider) {
  return { ...provider, lookup: vi.fn((payout: Payout) => provider.lookup(payout)),
    submit: vi.fn((...args: Parameters<FileFakeProvider["submit"]>) => provider.submit(...args)) };
}
function resign(document: Record<string, unknown>) {
  const { checksum: _checksum, ...body } = document;
  return JSON.stringify({ ...body, checksum: walletDigest(body) });
}

describe("logical backup and mandatory quarantined restore", () => {
  it("preserves exact bigint state, every original row/hash and original timestamps before appending a durable pause", async () => {
    let clock = FIXTURE_TIME;
    const source = await connected("source", true, () => clock);
    const fixture = durableFixture(source.wallet, BSC);
    const amount = "9007199254740993.123456789012345678";
    await fixture.deposit(amount);
    clock += 100;
    await fixture.ready();
    clock += 100;
    const payout = (await fixture.command("requestWithdrawal", SELLER, {
      id: "exact-backup", assetId: BSC, amount, destination: simulatedDestination(BSC, SELLER.id), stepUpReference: "sim-stepup-backup",
    })).result;
    const original = await source.wallet.snapshot();
    const originalRows = await rows(source.store);
    const serialized = await backup(source.store, clock + 100);
    const inspection = inspectWalletBackup(serialized);
    expect(inspection.checkpoint).toEqual({ revision: original.revision, eventHash: original.eventHash,
      stateHash: walletDigest(original.state), lastCommandAtMs: clock });
    const target = await connected("target", false, () => clock + 500);
    const result = await restoreWalletBackup({ mode: "simulation-only", store: target.store, backup: serialized,
      acknowledgeFreshTarget: true, clock: () => clock + 500, expectedChecksum: inspection.checksum });
    expect(result.quarantined).toBe(true);
    expect(result.backup.checkpoint).toEqual(inspection.checkpoint);
    const restored = await target.wallet.snapshot();
    expect(restored.revision).toBe(original.revision + 1);
    expect(restored.eventHash).toBe(result.restored.eventHash);
    expect(restored.state.haltReason).toBe("Operator emergency pause");
    expect(restored.state.idempotency.size).toBe(original.state.idempotency.size + 1);
    const originalIdempotency = new Map([...restored.state.idempotency].slice(0, original.state.idempotency.size));
    expect({ ...restored.state, haltReason: original.state.haltReason, idempotency: originalIdempotency }).toEqual(original.state);
    expect(restored.state.payouts.get(payout.id)?.amountRaw).toBe(BigInt("9007199254740993123456789012345678"));
    const restoredRows = await rows(target.store);
    expect(restoredRows.slice(0, -1)).toEqual(originalRows);
    expect(restoredRows.at(-1)).toMatchObject({ command_type: "pause", command_key: result.quarantineCommandKey,
      occurred_at_ms: String(clock + 500), previous_event_hash: original.eventHash });
    assertLedgerInvariants(restored.state);
    await target.store.close();
    const reopened = await connected("target", true, () => clock + 500);
    expect(await reopened.wallet.snapshot()).toEqual(restored);
    await expect(reopened.wallet.execute(walletCommand("beginDispatch", DISPATCHER, "post-reopen-dispatch", payout.id)))
      .rejects.toThrow(/Wallet paused/);
  }, TIMEOUT);

  it("holds a stale queued backup even when the original provider accepted and finalized a transfer after that backup", async () => {
    const source = await connected("source"), payout = await queuedWithdrawal(source);
    const serialized = await backup(source.store);
    const provider = await createFileFakeProvider({ mode: "simulation-only", dataDir: join(directory, "provider") });
    const claimed = (await source.fixture.command("beginDispatch", DISPATCHER, payout.id)).result.payout;
    await provider.submit(claimed);
    await provider.finalize(claimed, true);
    expect((await provider.lookup(claimed)).status).toBe("finalized");

    const target = await connected("target", false, () => FIXTURE_TIME + 1_000);
    await restore(target.store, serialized);
    const recovered = await target.wallet.snapshot();
    expect(recovered.state.payouts.get(payout.id)).toMatchObject({ state: "queued", dispatchCount: 0, providerReference: payout.providerReference });
    expect(balance(recovered.state, TRON, `payout:${payout.id}`)).toBe(parseUnits("200", 6));
    const observed = watched(provider);
    const worker = createSimulationPayoutWorker({ mode: "simulation-only", wallet: target.wallet, provider: observed });
    expect(await worker.step(payout.id)).toEqual({ payoutId: payout.id, status: "held_by_policy" });
    expect(observed.submit).not.toHaveBeenCalled();
    expect(observed.lookup).not.toHaveBeenCalled();
    await expect(target.wallet.execute(walletCommand("beginDispatch", DISPATCHER, "stale-backup-dispatch", payout.id)))
      .rejects.toThrow(/Wallet paused/);
    expect(await target.wallet.snapshot()).toEqual(recovered);
    expect((await provider.lookup(claimed)).status).toBe("finalized");
  }, TIMEOUT);

  it.each(["submitting", "submission_unknown", "broadcast"] as const)("preserves an original %s payout and permits lookup only, never another provider submission", async status => {
    const source = await connected("source"), payout = await queuedWithdrawal(source);
    const claim = walletCommand("beginDispatch", DISPATCHER, "original-claim", payout.id);
    const claimed = await source.wallet.execute(claim);
    const provider = await createFileFakeProvider({ mode: "simulation-only", dataDir: join(directory, "provider") });
    if (status === "submission_unknown") {
      await expect(provider.submit(claimed.result.payout, { loseResponseAfterAccept: true })).rejects.toThrow(/response was lost/);
      await source.fixture.command("recordSubmission", DISPATCHER, { payoutId: payout.id, outcome: "unknown" });
    } else if (status === "broadcast") {
      const accepted = await provider.submit(claimed.result.payout);
      await source.fixture.command("recordSubmission", DISPATCHER, { payoutId: payout.id, outcome: "broadcast", transactionId: accepted.transactionId });
    }
    const serialized = await backup(source.store);
    const target = await connected("target", false, () => FIXTURE_TIME + 1_000);
    await restore(target.store, serialized);
    expect((await target.wallet.snapshot()).state.payouts.get(payout.id)?.state).toBe(status);
    const replay = await target.wallet.execute(claim);
    expect(replay).toMatchObject({ replayed: true, eventHash: claimed.eventHash, result: { shouldDispatch: false,
      payout: { state: status, dispatchCount: 1, providerReference: payout.providerReference } } });
    const observed = watched(provider);
    const worker = createSimulationPayoutWorker({ mode: "simulation-only", wallet: target.wallet, provider: observed });
    expect((await worker.step(payout.id)).status).toBe(status === "submitting" ? "provider_lookup_required" : "broadcast");
    expect(observed.submit).not.toHaveBeenCalled();
    expect(observed.lookup).toHaveBeenCalledTimes(1);
    const after = await target.wallet.snapshot();
    expect(after.state.haltReason).toBe("Operator emergency pause");
    expect(after.state.payouts.get(payout.id)?.dispatchCount).toBe(1);
    expect(balance(after.state, TRON, `payout:${payout.id}`)).toBe(parseUnits("200", 6));
  }, TIMEOUT);

  it("rejects tampering, recomputed inconsistent checksums, truncation and unsupported versions before opening a target transaction", async () => {
    const source = await connected("source");
    await source.fixture.deposit("500");
    const serialized = await backup(source.store);
    const valid = JSON.parse(serialized) as Record<string, unknown>;
    const records = valid.commands as Array<Record<string, unknown>>;
    const changedRecord = { ...records[1], command_json: { ...(records[1]!.command_json as Record<string, unknown>),
      requestId: "rewritten-request" } };
    const candidates = [
      serialized.slice(0, -10),
      JSON.stringify({ ...valid, checksum: "a".repeat(64) }),
      resign({ ...valid, formatVersion: 2 }),
      resign({ ...valid, engineVersion: "unreviewed-wallet-engine" }),
      resign({ ...valid, commands: records.slice(0, -1) }),
      resign({ ...valid, commands: [records[0], changedRecord] }),
      resign({ ...valid, checkpoint: { ...(valid.checkpoint as Record<string, unknown>), stateHash: "b".repeat(64) } }),
    ];
    const unreachable: WalletStore = { transaction: vi.fn(async () => { throw new Error("Target transaction must not run"); }), close: vi.fn(async () => undefined) };
    for (const candidate of candidates) {
      expect(() => inspectWalletBackup(candidate)).toThrow();
      await expect(restore(unreachable, candidate)).rejects.toThrow();
    }
    expect(unreachable.transaction).not.toHaveBeenCalled();
    expect((await source.wallet.snapshot()).revision).toBe(2);
  }, TIMEOUT);

  it("requires the explicitly supplied independent checksum to match before target writes", async () => {
    const source = await connected("source"), serialized = await backup(source.store);
    const unreachable: WalletStore = { transaction: vi.fn(async () => { throw new Error("Target transaction must not run"); }), close: async () => undefined };
    await expect(restoreWalletBackup({ mode: "simulation-only", store: unreachable, backup: serialized,
      acknowledgeFreshTarget: true, expectedChecksum: "a".repeat(64), clock: () => FIXTURE_TIME }))
      .rejects.toThrow(/expected checksum/);
    expect(unreachable.transaction).not.toHaveBeenCalled();
  }, TIMEOUT);

  it("refuses an existing wallet without changing its state, even when the supplied backup is valid", async () => {
    const source = await connected("source");
    await source.fixture.deposit("500");
    const serialized = await backup(source.store);
    const target = await connected("target");
    await target.fixture.command("createDepositIntent", SELLER, { id: "existing-intent", assetId: TRON, purpose: "commission" });
    const before = await target.wallet.snapshot(), originalRows = await rows(target.store);
    await expect(restore(target.store, serialized)).rejects.toThrow(/no committed wallet commands/);
    expect(await target.wallet.snapshot()).toEqual(before);
    expect(await rows(target.store)).toEqual(originalRows);
  }, TIMEOUT);

  it("refuses a target containing unrelated application relations without creating a wallet schema or deleting data", async () => {
    const source = await connected("source"), serialized = await backup(source.store);
    const target = await connected("target", false);
    await target.store.transaction(async tx => { await tx.exec("CREATE TABLE public.keep_me(value text); INSERT INTO public.keep_me VALUES ('preserved')"); });
    await expect(restore(target.store, serialized)).rejects.toThrow(/fresh isolated development database/);
    const evidence = await target.store.transaction(async tx => ({
      schema: (await tx.query("SELECT to_regnamespace('alpha_wallet_simulation')::text AS name")).rows,
      data: (await tx.query("SELECT value FROM public.keep_me")).rows,
    }));
    expect(evidence.schema).toEqual([{ name: null }]);
    expect(evidence.data).toEqual([{ value: "preserved" }]);
  }, TIMEOUT);

  it("rolls back schema, commands and projections if writing the final quarantine command fails", async () => {
    const source = await connected("source");
    await source.fixture.deposit("500");
    const serialized = await backup(source.store), target = await connected("target", false, () => FIXTURE_TIME + 1_000);
    let insertedOriginals = 0, attemptedPause = false;
    const failed = wrapped(target.store, tx => ({
      exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        if (sql.startsWith("INSERT INTO alpha_wallet_simulation.commands")) {
          if (params?.[2] === "pause") { attemptedPause = true; await tx.query("SELECT 1 / 0"); }
          else insertedOriginals++;
        }
        return tx.query<Row>(sql, params);
      },
    }));
    await expect(restore(failed, serialized)).rejects.toThrow(/division by zero/i);
    expect(insertedOriginals).toBe(2);
    expect(attemptedPause).toBe(true);
    const namespace = await target.store.transaction(async tx => (await tx.query("SELECT to_regnamespace('alpha_wallet_simulation')::text AS name")).rows);
    expect(namespace).toEqual([{ name: null }]);
    await restore(target.store, serialized);
    const recovered = await target.wallet.snapshot();
    expect(recovered.revision).toBe(3);
    expect(expectedCustody(recovered.state, TRON)).toBe(parseUnits("500", 6));
    expect(recovered.state.haltReason).toBe("Operator emergency pause");
  }, TIMEOUT);

  it("preserves a committed paused restore after acknowledgement loss and requires inspecting the same target", async () => {
    const source = await connected("source"), payout = await queuedWithdrawal(source);
    const original = await source.wallet.snapshot();
    const originalRows = await rows(source.store);
    const serialized = await backup(source.store);
    const target = await connected("target", false, () => FIXTURE_TIME + 1_000);
    let completedTransactions = 0;
    const lostReply: WalletStore = {
      async transaction(work) {
        // The real storage transaction commits; only its returned acknowledgement
        // is then lost. This is synthetic response loss, not a network partition.
        await target.store.transaction(work);
        completedTransactions++;
        throw new CommitOutcomeUnknownError(new Error("Synthetic restore acknowledgement loss"));
      },
      close: () => target.store.close(),
    };
    await expect(restore(lostReply, serialized)).rejects.toMatchObject({ code: "ALPHA_WALLET_COMMIT_OUTCOME_UNKNOWN" });
    expect(completedTransactions).toBe(1);
    await target.store.close();
    const reopened = await connected("target", true, () => FIXTURE_TIME + 1_000);
    const recovered = await reopened.wallet.snapshot();
    expect(recovered.revision).toBe(original.revision + 1);
    expect(recovered.state.haltReason).toBe("Operator emergency pause");
    expect((await rows(reopened.store)).slice(0, -1)).toEqual(originalRows);
    expect(balance(recovered.state, TRON, `payout:${payout.id}`)).toBe(parseUnits("200", 6));
    expect(expectedCustody(recovered.state, TRON)).toBe(parseUnits("500", 6));
    // Repeating restore does not erase or replace the already committed target.
    await expect(restore(reopened.store, serialized)).rejects.toThrow(/no committed wallet commands/);
    await expect(reopened.wallet.execute(walletCommand("beginDispatch", DISPATCHER, "after-unknown-restore", payout.id)))
      .rejects.toThrow(/Wallet paused/);
    expect(await reopened.wallet.snapshot()).toEqual(recovered);
  }, TIMEOUT);

  it("requires fresh-target acknowledgment and a valid nondecreasing restore clock before any target writes", async () => {
    const source = await connected("source");
    await source.fixture.deposit("500");
    const serialized = await backup(source.store);
    const unreachable: WalletStore = { transaction: vi.fn(async () => { throw new Error("Target transaction must not run"); }), close: async () => undefined };
    await expect(restoreWalletBackup({ mode: "simulation-only", store: unreachable, backup: serialized,
      acknowledgeFreshTarget: false as unknown as true, clock: () => FIXTURE_TIME })).rejects.toThrow(/acknowledgment/);
    await expect(restore(unreachable, serialized, FIXTURE_TIME - 1)).rejects.toThrow(/clock precedes/);
    await expect(restore(unreachable, serialized, NaN)).rejects.toThrow(/Invalid backup\/restore clock/);
    expect(unreachable.transaction).not.toHaveBeenCalled();
  }, TIMEOUT);

  it("exports only a repository whose SQL projections agree with verified command history", async () => {
    const source = await connected("source");
    await source.fixture.deposit("500");
    const inconsistent = wrapped(source.store, tx => ({
      exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await tx.query<Row>(sql, params);
        if (sql === "SELECT journal_id,command_revision,asset_id,operation FROM alpha_wallet_simulation.journals") {
          return { rows: [] as Row[] };
        }
        return result;
      },
    }));
    await expect(backup(inconsistent)).rejects.toThrow(/journals disagree with verified command history/);
    expect((await source.wallet.snapshot()).revision).toBe(2);
  }, TIMEOUT);

  it("quarantines even an empty backup and never resumes after matching reconciliation or native-fee readiness", async () => {
    const source = await connected("source"), serialized = await backup(source.store);
    const target = await connected("target", true, () => FIXTURE_TIME + 1_000);
    const result = await restore(target.store, serialized);
    expect(result.backup.checkpoint.revision).toBe(0);
    expect(result.restored.revision).toBe(1);
    expect(result.quarantined).toBe(true);
    const reconciled = await target.fixture.command("reconcileAsset", VERIFIER, { assetId: TRON, observedRaw: "0", complete: true });
    expect(reconciled.result).toEqual({ matched: true, halted: true });
    await target.fixture.command("setNativeFeeReadiness", OPERATOR, { assetId: TRON, ready: true });
    await expect(target.fixture.command("createListing", SELLER, { id: "still-paused", assetId: TRON, amount: "500", price: "3.20", currency: "ILS" }))
      .rejects.toThrow(/Wallet paused/);
    const paused = await target.wallet.snapshot();
    expect(paused.state.haltReason).toBe("Operator emergency pause");
    await target.store.close();
    const reopened = await connected("target", true, () => FIXTURE_TIME + 1_000);
    expect(await reopened.wallet.snapshot()).toEqual(paused);
  }, TIMEOUT);
});
