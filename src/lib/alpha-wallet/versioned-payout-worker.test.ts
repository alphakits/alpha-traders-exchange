// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_TIME, OPERATOR, SELLER, TRON, durableFixture } from "../../../scripts/alpha-wallet/durable-fixtures";
import { parseUnits } from "./amounts";
import { walletDigest } from "./commands";
import { createDurableWallet, initializeDurableWallet } from "./durable";
import { CommitOutcomeUnknownError, createFileWalletStore, type WalletSql, type WalletStore } from "./durable-store";
import { createFileFakeProvider, type FileFakeProvider } from "./fake-provider";
import { balance, expectedCustody } from "./ledger";
import { createSimulationPayoutWorker } from "./payout-worker";
import { simulatedDestination } from "./sandbox";
import type { Payout } from "./types";
import { v2Command, WALLET_V2_ENGINE_VERSION } from "./v2-commands";
import { createVersionedDurableWallet, upgradeDurableWalletV2 } from "./versioned-durable";
import { createVersionedSimulationPayoutWorker } from "./versioned-payout-worker";

const directories: string[] = [];
const stores: WalletStore[] = [];
const TIMEOUT = 90_000;

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  for (const name of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) vi.stubEnv(name, undefined);
});
afterEach(async () => {
  await Promise.allSettled(stores.splice(0).map(store => store.close()));
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

async function scenario() {
  const root = await mkdtemp(join(tmpdir(), "alpha-wallet-v2-worker-")); directories.push(root);
  const dataDir = join(root, "wallet");
  const store = await createFileWalletStore({ mode: "simulation-only", dataDir }); stores.push(store);
  await initializeDurableWallet(store);
  const original = createDurableWallet({ mode: "simulation-only", store, clock: () => FIXTURE_TIME });
  const provider = await createFileFakeProvider({ mode: "simulation-only", dataDir: join(root, "provider") });
  return { store, original, fixture: durableFixture(original), provider, dataDir };
}
function watched(provider: FileFakeProvider) {
  return { ...provider, submit: vi.fn((payout: Payout) => provider.submit(payout)), lookup: vi.fn((payout: Payout) => provider.lookup(payout)) };
}
async function upgrade(context: Awaited<ReturnType<typeof scenario>>) {
  const current = await context.original.snapshot();
  await upgradeDurableWalletV2({ mode: "simulation-only", store: context.store, acknowledgeVersionUpgrade: true,
    clock: () => FIXTURE_TIME, command: v2Command("continueFromV1", OPERATOR, "worker-v2-upgrade", {
      checkpoint: { revision: current.revision, eventHash: current.eventHash, stateHash: walletDigest(current.state), lastCommandAtMs: current.revision ? FIXTURE_TIME : 0 },
    }) });
  return createVersionedDurableWallet({ mode: "simulation-only", store: context.store, clock: () => FIXTURE_TIME });
}
async function queuedWithdrawal(context: Awaited<ReturnType<typeof scenario>>) {
  await context.fixture.deposit("500"); await context.fixture.ready();
  return (await context.fixture.command("requestWithdrawal", SELLER, { id: "v2-worker-withdrawal", assetId: TRON,
    amount: "200", destination: simulatedDestination(TRON, SELLER.id), stepUpReference: "sim-stepup-v2-worker" })).result;
}

describe("explicit v2 offline worker using the retained recovery algorithm", () => {
  it("refuses a v1 ledger without upgrading or calling a provider", async () => {
    const context = await scenario(), payout = await queuedWithdrawal(context);
    const provider = watched(context.provider), before = await context.original.snapshot();
    const wallet = createVersionedDurableWallet({ mode: "simulation-only", store: context.store });
    const worker = createVersionedSimulationPayoutWorker({ mode: "simulation-only", wallet, provider });
    await expect(worker.step(payout.id)).rejects.toThrow("explicitly upgraded v2");
    expect(await context.original.snapshot()).toEqual(before);
    expect(provider.submit).not.toHaveBeenCalled(); expect(provider.lookup).not.toHaveBeenCalled();
  }, TIMEOUT);

  it("reconciles a v1 unknown payout after upgrade/reopen and pause without submitting again", async () => {
    const context = await scenario(), payout = await queuedWithdrawal(context);
    const lossy = { ...context.provider, submit: vi.fn((value: Payout) => context.provider.submit(value, { loseResponseAfterAccept: true })) };
    const oldWorker = createSimulationPayoutWorker({ mode: "simulation-only", wallet: context.original, provider: lossy });
    expect((await oldWorker.step(payout.id)).status).toBe("submission_unknown");
    expect(lossy.submit).toHaveBeenCalledTimes(1);
    await upgrade(context); await context.store.close();
    const reopened = await createFileWalletStore({ mode: "simulation-only", dataDir: context.dataDir }); stores.push(reopened);
    const wallet = createVersionedDurableWallet({ mode: "simulation-only", store: reopened, clock: () => FIXTURE_TIME });
    await wallet.execute(v2Command("pause", OPERATOR, "pause-upgraded-recovery", null));
    const provider = watched(context.provider);
    provider.lookup.mockResolvedValueOnce({ status: "not_found" });
    const worker = createVersionedSimulationPayoutWorker({ mode: "simulation-only", wallet, provider });
    const held = await wallet.snapshot();
    expect((await worker.step(payout.id)).status).toBe("provider_lookup_required");
    expect(await wallet.snapshot()).toEqual(held);
    expect((await worker.step(payout.id)).status).toBe("broadcast");
    await provider.finalize(payout, true);
    expect((await worker.step(payout.id)).status).toBe("confirmed");
    const settled = await wallet.snapshot();
    expect((await worker.step(payout.id)).status).toBe("confirmed");
    expect(await wallet.snapshot()).toEqual(settled);
    expect(settled.engineVersion).toBe(WALLET_V2_ENGINE_VERSION);
    expect(settled.state.haltReason).toBe("Operator emergency pause");
    expect(settled.state.payouts.get(payout.id)).toMatchObject({ state: "confirmed", providerReference: payout.providerReference, dispatchCount: 1 });
    expect(expectedCustody(settled.state, TRON)).toBe(parseUnits("300", 6));
    expect(settled.state.receipts.size).toBe(1);
    expect(provider.submit).not.toHaveBeenCalled();
  }, TIMEOUT);

  it("settles an inherited queued trade under v2 once with separate commission due", async () => {
    const context = await scenario(), payout = await context.fixture.queuedTrade("200");
    const wallet = await upgrade(context), provider = watched(context.provider);
    const worker = createVersionedSimulationPayoutWorker({ mode: "simulation-only", wallet, provider });
    expect((await worker.step(payout.id)).status).toBe("broadcast");
    await provider.finalize(payout, true);
    expect((await worker.step(payout.id)).status).toBe("confirmed");
    const settled = await wallet.snapshot();
    expect((await worker.step(payout.id)).status).toBe("confirmed");
    expect((await wallet.snapshot()).revision).toBe(settled.revision);
    expect(provider.submit).toHaveBeenCalledTimes(1);
    expect(settled.state.trades.get(payout.tradeId!)?.status).toBe("completed");
    expect(settled.state.commissions.get(payout.tradeId!)).toMatchObject({ amountRaw: parseUnits("4", 6), paid: false });
    expect(expectedCustody(settled.state, TRON)).toBe(parseUnits("300", 6));
    expect(balance(settled.state, TRON, "platform-revenue")).toBe(BigInt(0));
  }, TIMEOUT);

  it("does not call the provider after a v2 dispatch claim loses its commit acknowledgement", async () => {
    const context = await scenario(), payout = await queuedWithdrawal(context);
    const committedWallet = await upgrade(context);
    let loseAcknowledgement = true;
    const uncertain: WalletStore = { close: async () => undefined, async transaction(work) {
      let claimed = false;
      const committed = await context.store.transaction(tx => {
        const observed: WalletSql = {
          exec: sql => tx.exec(sql),
          async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
            if (/INSERT INTO alpha_wallet_simulation\.commands/i.test(sql) && params?.[2] === "beginDispatch") claimed = true;
            return tx.query<Row>(sql, params);
          },
        };
        return work(observed);
      });
      if (claimed && loseAcknowledgement) { loseAcknowledgement = false; throw new CommitOutcomeUnknownError(new Error("synthetic v2 acknowledgement lost after actual commit")); }
      return committed;
    } };
    const wallet = createVersionedDurableWallet({ mode: "simulation-only", store: uncertain, clock: () => FIXTURE_TIME });
    const provider = watched(context.provider), worker = createVersionedSimulationPayoutWorker({ mode: "simulation-only", wallet, provider });
    await expect(worker.step(payout.id)).rejects.toBeInstanceOf(CommitOutcomeUnknownError);
    expect(provider.submit).not.toHaveBeenCalled(); expect(provider.lookup).not.toHaveBeenCalled();
    expect((await committedWallet.snapshot()).state.payouts.get(payout.id)).toMatchObject({ state: "submitting", dispatchCount: 1 });
    expect((await worker.step(payout.id)).status).toBe("provider_lookup_required");
    expect(provider.submit).not.toHaveBeenCalled();
    expect(balance((await wallet.snapshot()).state, TRON, `payout:${payout.id}`)).toBe(parseUnits("200", 6));
  }, TIMEOUT);

  it("keeps an inherited queued payout held when the upgraded wallet is paused", async () => {
    const context = await scenario(), payout = await queuedWithdrawal(context);
    const wallet = await upgrade(context), provider = watched(context.provider);
    await wallet.execute(v2Command("pause", OPERATOR, "pause-before-v2-dispatch", null));
    const before = await wallet.snapshot();
    const worker = createVersionedSimulationPayoutWorker({ mode: "simulation-only", wallet, provider });
    expect((await worker.step(payout.id)).status).toBe("held_by_policy");
    expect(await wallet.snapshot()).toEqual(before);
    expect(provider.lookup).not.toHaveBeenCalled(); expect(provider.submit).not.toHaveBeenCalled();
  }, TIMEOUT);
});
