// @vitest-environment node
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUYER, DISPATCHER, FIXTURE_TIME, OPERATOR, SELLER, TRON, VERIFIER, durableFixture } from "../../../scripts/alpha-wallet/durable-fixtures";
import { parseUnits } from "./amounts";
import { createDurableWallet, initializeDurableWallet } from "./durable";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { createFileFakeProvider, SimulatedProviderResponseLostError, type FileFakeProvider } from "./fake-provider";
import { balance, expectedCustody } from "./ledger";
import { createSimulationPayoutWorker, type WorkerResult } from "./payout-worker";
import { simulatedDestination } from "./sandbox";
import type { Payout, State } from "./types";

const directories: string[] = [];
const stores: WalletStore[] = [];
const units = (value: string) => parseUnits(value, 6);

async function openWallet(dataDir: string) {
  const store = await createFileWalletStore({ mode: "simulation-only", dataDir });
  stores.push(store);
  await initializeDurableWallet(store);
  const wallet = createDurableWallet({ mode: "simulation-only", store, clock: () => FIXTURE_TIME });
  return { store, wallet, fixture: durableFixture(wallet) };
}
async function scenario() {
  const root = await mkdtemp(join(tmpdir(), "alpha-wallet-worker-test-"));
  directories.push(root);
  const dataDir = join(root, "wallet"), providerDir = join(root, "provider");
  const connected = await openWallet(dataDir);
  const provider = await createFileFakeProvider({ mode: "simulation-only", dataDir: providerDir });
  return { ...connected, root, dataDir, providerDir, provider };
}
function watched(provider: FileFakeProvider) {
  return {
    ...provider,
    submit: vi.fn((...args: Parameters<FileFakeProvider["submit"]>) => provider.submit(...args)),
    lookup: vi.fn((payout: Payout) => provider.lookup(payout)),
  };
}
async function queuedWithdrawal(context: Awaited<ReturnType<typeof scenario>>, amount = "200") {
  await context.fixture.deposit("500");
  await context.fixture.ready();
  return (await context.fixture.command("requestWithdrawal", SELLER, {
    id: "worker-withdrawal", assetId: TRON, amount, destination: simulatedDestination(TRON, SELLER.id), stepUpReference: "sim-stepup-worker",
  })).result;
}
function settlementDebits(state: State, payout: Payout) {
  return state.journal.flatMap(journal => journal.entries)
    .filter(entry => entry.account === `payout:${payout.id}` && entry.delta < BigInt(0));
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
});
afterEach(async () => {
  await Promise.allSettled(stores.splice(0).map(store => store.close()));
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

describe("durable offline payout worker", () => {
  it("settles a trade once and keeps both commission portions separate from buyer principal", async () => {
    const context = await scenario(), payout = await context.fixture.queuedTrade("200");
    const provider = watched(context.provider);
    const worker = createSimulationPayoutWorker({ mode: "simulation-only", wallet: context.wallet, provider });
    expect(await worker.step(payout.id)).toEqual({ payoutId: payout.id, status: "broadcast" });
    let state = (await context.wallet.snapshot()).state;
    expect(balance(state, TRON, `payout:${payout.id}`)).toBe(units("200"));
    await provider.finalize(payout, true);
    expect(await worker.step(payout.id)).toEqual({ payoutId: payout.id, status: "confirmed" });
    const afterConfirmation = await context.wallet.snapshot();
    expect(await worker.step(payout.id)).toEqual({ payoutId: payout.id, status: "confirmed" });
    expect((await context.wallet.snapshot()).revision).toBe(afterConfirmation.revision);
    state = afterConfirmation.state;
    expect(provider.submit).toHaveBeenCalledTimes(1);
    expect(state.payouts.get(payout.id)?.dispatchCount).toBe(1);
    expect(state.receipts.size).toBe(1);
    expect(settlementDebits(state, payout)).toEqual([{ account: `payout:${payout.id}`, delta: -units("200") }]);
    expect(expectedCustody(state, TRON)).toBe(units("300"));
    expect(state.commissions.get(payout.tradeId!)?.amountRaw).toBe(units("4"));
    expect(state.commissions.get(payout.tradeId!)?.paid).toBe(false);
    expect(balance(state, TRON, "platform-revenue")).toBe(BigInt(0));
  }, 30000);

  it("allows only one provider submission when two asynchronous workers contend for a queued payout", async () => {
    const context = await scenario(), payout = await queuedWithdrawal(context);
    const provider = watched(context.provider);
    const first = createSimulationPayoutWorker({ mode: "simulation-only", wallet: context.wallet, provider });
    const second = createSimulationPayoutWorker({ mode: "simulation-only", wallet: context.wallet, provider });
    const results = await Promise.all([first.step(payout.id), second.step(payout.id)]);
    expect(results.every(result => ["broadcast", "provider_lookup_required"].includes(result.status))).toBe(true);
    expect(provider.submit).toHaveBeenCalledTimes(1);
    const state = (await context.wallet.snapshot()).state;
    expect(state.payouts.get(payout.id)).toMatchObject({ state: "broadcast", dispatchCount: 1, providerReference: payout.providerReference });
    expect(balance(state, TRON, `payout:${payout.id}`)).toBe(payout.amountRaw);
    expect((await readdir(context.providerDir)).filter(name => name.endsWith(".broadcast.json"))).toHaveLength(1);
    // These are asynchronous workers on the file store, not independent PostgreSQL processes.
  }, 30000);

  it("recovers a lost provider response after reopening and confirms by lookup without another submission", async () => {
    const context = await scenario(), payout = await queuedWithdrawal(context);
    const lossy = {
      ...context.provider,
      submit: vi.fn((value: Payout) => context.provider.submit(value, { loseResponseAfterAccept: true })),
    };
    const first = createSimulationPayoutWorker({ mode: "simulation-only", wallet: context.wallet, provider: lossy });
    expect(await first.step(payout.id)).toEqual({ payoutId: payout.id, status: "submission_unknown" });
    expect(lossy.submit).toHaveBeenCalledTimes(1);
    expect((await context.wallet.snapshot()).state.payouts.get(payout.id)).toMatchObject({ state: "submission_unknown", dispatchCount: 1 });
    await context.store.close();

    const reopened = await openWallet(context.dataDir);
    const provider = watched(await createFileFakeProvider({ mode: "simulation-only", dataDir: context.providerDir }));
    const recovered = createSimulationPayoutWorker({ mode: "simulation-only", wallet: reopened.wallet, provider });
    expect(await recovered.step(payout.id)).toEqual({ payoutId: payout.id, status: "broadcast" });
    await provider.finalize(payout, true);
    expect(await recovered.step(payout.id)).toEqual({ payoutId: payout.id, status: "confirmed" });
    const confirmed = await reopened.wallet.snapshot();
    expect(await recovered.step(payout.id)).toEqual({ payoutId: payout.id, status: "confirmed" });
    expect((await reopened.wallet.snapshot()).revision).toBe(confirmed.revision);
    expect(provider.submit).not.toHaveBeenCalled();
    expect(confirmed.state.receipts.size).toBe(1);
    expect(settlementDebits(confirmed.state, payout)).toHaveLength(1);
    expect(expectedCustody(confirmed.state, TRON)).toBe(units("300"));
    expect((await readdir(context.providerDir)).filter(name => name.endsWith(".broadcast.json"))).toHaveLength(1);
  }, 30000);

  it("holds a committed dispatch claim with no provider record across reopen and never resubmits it", async () => {
    const context = await scenario(), payout = await queuedWithdrawal(context);
    const claim = await context.fixture.command("beginDispatch", DISPATCHER, payout.id);
    expect(claim.result.shouldDispatch).toBe(true);
    await context.store.close();
    const reopened = await openWallet(context.dataDir), provider = watched(context.provider);
    const worker = createSimulationPayoutWorker({ mode: "simulation-only", wallet: reopened.wallet, provider });
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await worker.step(payout.id)).toEqual({ payoutId: payout.id, status: "provider_lookup_required" });
    }
    const state = (await reopened.wallet.snapshot()).state;
    expect(provider.submit).not.toHaveBeenCalled();
    expect(state.payouts.get(payout.id)).toMatchObject({ state: "submitting", dispatchCount: 1, providerReference: payout.providerReference });
    expect(balance(state, TRON, `payout:${payout.id}`)).toBe(payout.amountRaw);
    expect(expectedCustody(state, TRON)).toBe(units("500"));
    expect(settlementDebits(state, payout)).toHaveLength(0);
  }, 30000);

  it("keeps principal reserved after a final failure without claiming completion or refund", async () => {
    const context = await scenario(), payout = await queuedWithdrawal(context), provider = watched(context.provider);
    const worker = createSimulationPayoutWorker({ mode: "simulation-only", wallet: context.wallet, provider });
    await worker.step(payout.id);
    await provider.finalize(payout, false);
    expect(await worker.step(payout.id)).toEqual({ payoutId: payout.id, status: "failed_final" });
    expect(await worker.step(payout.id)).toEqual({ payoutId: payout.id, status: "failed_final" });
    const state = (await context.wallet.snapshot()).state;
    expect(provider.submit).toHaveBeenCalledTimes(1);
    expect(balance(state, TRON, `payout:${payout.id}`)).toBe(payout.amountRaw);
    expect(balance(state, TRON, `available:${SELLER.id}`)).toBe(units("300"));
    expect(expectedCustody(state, TRON)).toBe(units("500"));
    expect(settlementDebits(state, payout)).toHaveLength(0);
    expect(state.receipts.size).toBe(1);
    expect(await context.wallet.recoverPayouts()).toEqual([{ payout: state.payouts.get(payout.id), action: "manual_recovery_required" }]);
  }, 30000);

  it.each(["pause", "dispute"] as const)("does not submit a queued payout after %s", async action => {
    const context = await scenario(), payout = await context.fixture.queuedTrade("200");
    if (action === "pause") await context.fixture.command("pause", OPERATOR, null);
    else await context.fixture.command("openDispute", BUYER, payout.tradeId!);
    const provider = watched(context.provider);
    const worker = createSimulationPayoutWorker({ mode: "simulation-only", wallet: context.wallet, provider });
    expect(await worker.step(payout.id)).toEqual({ payoutId: payout.id, status: "held_by_policy" });
    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.lookup).not.toHaveBeenCalled();
    const state = (await context.wallet.snapshot()).state;
    expect(state.payouts.get(payout.id)).toMatchObject({ state: "queued", dispatchCount: 0 });
    expect(balance(state, TRON, `payout:${payout.id}`)).toBe(payout.amountRaw);
  }, 30000);

  it("records an already broadcast transfer's real simulated settlement even after a dispute and pause", async () => {
    const context = await scenario(), payout = await context.fixture.queuedTrade("200"), provider = watched(context.provider);
    const worker = createSimulationPayoutWorker({ mode: "simulation-only", wallet: context.wallet, provider });
    await worker.step(payout.id);
    await context.fixture.command("openDispute", BUYER, payout.tradeId!);
    await context.fixture.command("pause", OPERATOR, null);
    await provider.finalize(payout, true);
    expect(await worker.step(payout.id)).toEqual({ payoutId: payout.id, status: "confirmed" });
    const state = (await context.wallet.snapshot()).state;
    expect(state.haltReason).toBeTruthy();
    expect(state.trades.get(payout.tradeId!)).toMatchObject({ status: "completed", disputed: true });
    expect(expectedCustody(state, TRON)).toBe(units("300"));
    expect(settlementDebits(state, payout)).toHaveLength(1);
    expect(provider.submit).toHaveBeenCalledTimes(1);
  }, 30000);

  it("never calls the provider after losing the database acknowledgement for its dispatch claim", async () => {
    const context = await scenario(), payout = await queuedWithdrawal(context);
    let loseAcknowledgement = true;
    const uncertainStore: WalletStore = {
      close: async () => undefined,
      async transaction(work) {
        let appendedClaim = false;
        const committed = await context.store.transaction(tx => {
          const observed: WalletSql = {
            async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
              if (sql.includes("INSERT INTO alpha_wallet_simulation.commands") && params?.[2] === "beginDispatch") appendedClaim = true;
              return tx.query<Row>(sql, params);
            },
            exec: sql => tx.exec(sql),
          };
          return work(observed);
        });
        if (appendedClaim && loseAcknowledgement) {
          loseAcknowledgement = false;
          throw new CommitOutcomeUnknownError(new Error("synthetic acknowledgement lost after commit"));
        }
        return committed;
      },
    };
    const uncertainWallet = createDurableWallet({ mode: "simulation-only", store: uncertainStore, clock: () => FIXTURE_TIME });
    const provider = watched(context.provider);
    const worker = createSimulationPayoutWorker({ mode: "simulation-only", wallet: uncertainWallet, provider });
    await expect(worker.step(payout.id)).rejects.toBeInstanceOf(CommitOutcomeUnknownError);
    expect(provider.submit).not.toHaveBeenCalled();
    expect(provider.lookup).not.toHaveBeenCalled();
    expect((await context.wallet.snapshot()).state.payouts.get(payout.id)).toMatchObject({ state: "submitting", dispatchCount: 1 });
    expect(await worker.step(payout.id)).toEqual({ payoutId: payout.id, status: "provider_lookup_required" });
    expect(provider.submit).not.toHaveBeenCalled();
    expect(balance((await context.wallet.snapshot()).state, TRON, `payout:${payout.id}`)).toBe(payout.amountRaw);
    // This injects loss of the acknowledgement after a real local commit;
    // driver-level network ambiguity is separately exercised by transport tests.
  }, 30000);

  it("returns an already known broadcast when a lost response arrives after a competing worker records it", async () => {
    const context = await scenario(), payout = await queuedWithdrawal(context);
    const peer = createSimulationPayoutWorker({ mode: "simulation-only", wallet: context.wallet, provider: context.provider });
    let peerOutcome: WorkerResult | undefined;
    const provider = {
      ...context.provider,
      submit: vi.fn(async (value: Payout) => {
        await context.provider.submit(value);
        peerOutcome = await peer.step(value.id);
        throw new SimulatedProviderResponseLostError();
      }),
    };
    const worker = createSimulationPayoutWorker({ mode: "simulation-only", wallet: context.wallet, provider });
    const expected: WorkerResult = { payoutId: payout.id, status: "broadcast" };
    expect(await worker.step(payout.id)).toEqual(expected);
    expect(peerOutcome).toEqual(expected);
    expect(provider.submit).toHaveBeenCalledTimes(1);
    const state = (await context.wallet.snapshot()).state;
    expect(state.payouts.get(payout.id)).toMatchObject({ state: "broadcast", dispatchCount: 1 });
    expect(balance(state, TRON, `payout:${payout.id}`)).toBe(payout.amountRaw);
    expect(settlementDebits(state, payout)).toHaveLength(0);
    expect((await readdir(context.providerDir)).filter(name => name.endsWith(".broadcast.json"))).toHaveLength(1);
  }, 30000);

  it.each([true, false])("returns the actual terminal outcome when a competing worker finalizes successful=%s before broadcast reporting", async successful => {
    const context = await scenario(), payout = await queuedWithdrawal(context);
    const peer = createSimulationPayoutWorker({ mode: "simulation-only", wallet: context.wallet, provider: context.provider });
    let peerOutcome: WorkerResult | undefined;
    const provider = {
      ...context.provider,
      submit: vi.fn(async (value: Payout) => {
        const accepted = await context.provider.submit(value);
        await context.provider.finalize(value, successful);
        peerOutcome = await peer.step(value.id);
        return accepted;
      }),
    };
    const worker = createSimulationPayoutWorker({ mode: "simulation-only", wallet: context.wallet, provider });
    const expected: WorkerResult = { payoutId: payout.id, status: successful ? "confirmed" : "failed_final" };
    expect(await worker.step(payout.id)).toEqual(expected);
    expect(peerOutcome).toEqual(expected);
    expect(provider.submit).toHaveBeenCalledTimes(1);
    const state = (await context.wallet.snapshot()).state;
    expect(state.payouts.get(payout.id)?.state).toBe(expected.status);
    expect(state.receipts.size).toBe(1);
    expect(settlementDebits(state, payout)).toHaveLength(successful ? 1 : 0);
    expect(expectedCustody(state, TRON)).toBe(units(successful ? "300" : "500"));
  }, 30000);

  it("does not swallow a late-report error when durable settlement names a different transaction", async () => {
    const context = await scenario(), payout = await queuedWithdrawal(context);
    const provider = {
      ...context.provider,
      submit: vi.fn(async (value: Payout) => {
        const accepted = await context.provider.submit(value);
        const finalized = await context.provider.finalize(value, true);
        if (finalized.status !== "finalized") throw new Error("Expected a finalized local fixture");
        await context.fixture.command("confirmPayout", VERIFIER, {
          ...finalized.receipt, transactionId: "sim-tx-unrelated-provider-transaction",
        });
        return accepted;
      }),
    };
    const worker = createSimulationPayoutWorker({ mode: "simulation-only", wallet: context.wallet, provider });
    await expect(worker.step(payout.id)).rejects.toThrow();
    expect(provider.submit).toHaveBeenCalledTimes(1);
    expect((await context.wallet.snapshot()).state.payouts.get(payout.id)?.transactionId).toBe("sim-tx-unrelated-provider-transaction");
    expect((await readdir(context.providerDir)).filter(name => name.endsWith(".broadcast.json"))).toHaveLength(1);
  }, 30000);
});
