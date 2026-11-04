/**
 * Offline, file-backed crash/restart demonstration. Both directories must be
 * explicit absolute paths. No environment database URL or network is used.
 *
 * NODE_ENV=development node --import tsx scripts/alpha-wallet/recovery-demo.ts prepare /tmp/wallet-demo /tmp/provider-demo --abrupt-exit
 * NODE_ENV=development node --import tsx scripts/alpha-wallet/recovery-demo.ts recover /tmp/wallet-demo /tmp/provider-demo
 */
import { strict as assert } from "node:assert";
import { createDurableWallet, initializeDurableWallet } from "../../src/lib/alpha-wallet/durable";
import { createFileWalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { createFileFakeProvider } from "../../src/lib/alpha-wallet/fake-provider";
import { createSimulationPayoutWorker } from "../../src/lib/alpha-wallet/payout-worker";
import { assertLedgerInvariants, balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { parseUnits } from "../../src/lib/alpha-wallet/amounts";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { durableFixture, FIXTURE_TIME, TRON } from "./durable-fixtures";

async function main() {
  assertSimulationRuntime("simulation-only");
  const [phase, dataDir, providerDir, abrupt, ...extra] = process.argv.slice(2);
  if (!["prepare", "recover"].includes(phase) || !dataDir || !providerDir || extra.length
    || (abrupt !== undefined && !(phase === "prepare" && abrupt === "--abrupt-exit"))) {
    throw new Error("Usage: recovery-demo.ts prepare|recover ABSOLUTE_WALLET_DIR ABSOLUTE_FAKE_PROVIDER_DIR [--abrupt-exit]");
  }
  const store = await createFileWalletStore({ mode: "simulation-only", dataDir });
  try {
    await initializeDurableWallet(store);
    const wallet = createDurableWallet({ mode: "simulation-only", store, clock: () => FIXTURE_TIME });
    const provider = await createFileFakeProvider({ mode: "simulation-only", dataDir: providerDir });
    let report: Record<string, unknown>;
    if (phase === "prepare") {
      assert.equal((await wallet.snapshot()).revision, 0, "Prepare requires a new simulation store");
      const payout = await durableFixture(wallet).queuedTrade("200");
      const losingResponse = { ...provider, submit: (intent: Parameters<typeof provider.submit>[0]) => provider.submit(intent, { loseResponseAfterAccept: true }) };
      const outcome = await createSimulationPayoutWorker({ mode: "simulation-only", wallet, provider: losingResponse }).step(payout.id);
      assert.equal(outcome.status, "submission_unknown");
      const snapshot = await wallet.snapshot(), saved = snapshot.state.payouts.get(payout.id)!;
      assert.equal(saved.dispatchCount, 1);
      assert.equal(balance(snapshot.state, TRON, `payout:${payout.id}`), parseUnits("200", 6));
      assertLedgerInvariants(snapshot.state);
      report = { phase, simulationOnly: true, payoutId: payout.id, revision: snapshot.revision, status: saved.state,
        dispatchCount: saved.dispatchCount, heldPrincipalRaw: saved.amountRaw.toString(), providerAccepted: true,
        exitsWithoutClosingStore: abrupt === "--abrupt-exit" };
      if (abrupt === "--abrupt-exit") {
        // Deliberately skip close()/finally. The next independent Node process
        // must recover only already-committed database/provider bytes.
        await new Promise<void>((_resolve, reject) => process.stdout.write(`${JSON.stringify(report)}\n`, error => {
          if (error) reject(error); else process.exit(0);
        }));
      }
    } else {
      const initial = await wallet.snapshot();
      assert.equal(initial.state.payouts.size, 1, "Recover expects the prepared single-payout fixture");
      const payout = [...initial.state.payouts.values()][0]!;
      const worker = createSimulationPayoutWorker({ mode: "simulation-only", wallet, provider });
      const recovered = await worker.step(payout.id);
      assert.equal(recovered.status, "broadcast");
      await provider.finalize(payout, true);
      const completed = await worker.step(payout.id);
      assert.equal(completed.status, "confirmed");
      const settled = await wallet.snapshot();
      const replay = await worker.step(payout.id);
      const afterReplay = await wallet.snapshot();
      assert.equal(replay.status, "confirmed");
      assert.equal(afterReplay.revision, settled.revision, "Repeated recovery must not append another settlement");
      assert.equal(balance(settled.state, TRON, `payout:${payout.id}`), BigInt(0));
      assert.equal(expectedCustody(settled.state, TRON), parseUnits("300", 6));
      const fee = settled.state.commissions.get(payout.tradeId!)!;
      assert.equal(fee.amountRaw, parseUnits("4", 6));
      assert.equal(fee.paid, false);
      assertLedgerInvariants(settled.state);
      report = { phase, simulationOnly: true, payoutId: payout.id, revision: settled.revision,
        status: settled.state.payouts.get(payout.id)!.state, dispatchCount: settled.state.payouts.get(payout.id)!.dispatchCount,
        deliveredPrincipalRaw: payout.amountRaw.toString(), remainingCustodyRaw: expectedCustody(settled.state, TRON).toString(),
        separateCommissionDueRaw: fee.amountRaw.toString(), repeatedRecoveryAddedSettlement: false };
    }
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally { await store.close(); }
}

void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "Simulation failed"}\n`); process.exitCode = 1; });
