/**
 * Explicit disposable PostgreSQL only. No database URL is read from the environment.
 * NODE_ENV=test node --import tsx scripts/alpha-wallet/postgres-concurrency.ts \
 *   --fresh-simulation-database --connection-string \
 *   postgresql://wallet_fixture:simulation-only@127.0.0.1:5432/alpha_wallet_dev_races
 *
 * The database must already exist and contain no application schema or public
 * relations. This harness never drops data. Its caller disposes of the fixture
 * database afterward. All identities, destinations, and amounts are synthetic.
 */
import { strict as assert } from "node:assert";
import { fork, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { assetFor, parseUnits } from "../../src/lib/alpha-wallet/amounts";
import { createDurableWallet, initializeDurableWallet, walletCommand, type DurableExecution } from "../../src/lib/alpha-wallet/durable";
import { CommitOutcomeUnknownError, createPostgresWalletStore, type WalletStore } from "../../src/lib/alpha-wallet/durable-store";
import { assertLedgerInvariants, balance, expectedCustody } from "../../src/lib/alpha-wallet/ledger";
import { assertSimulationRuntime } from "../../src/lib/alpha-wallet/runtime";
import { simulatedDestination } from "../../src/lib/alpha-wallet/sandbox";
import type { WalletCommand } from "../../src/lib/alpha-wallet/commands";
import type { DepositObservation, Payout, Trade } from "../../src/lib/alpha-wallet/types";
import { BUYER, DISPATCHER, FIXTURE_TIME, OPERATOR, SELLER, TRON, VERIFIER, durableFixture } from "./durable-fixtures";

type Reply = { id: number; kind: "result"; ok: true; value: unknown; attempts: number }
  | { id: number; kind: "result"; ok: false; error: { code?: string; message: string }; attempts: number };
type Request = { id: number; operation: "init" | "race" | "recover" | "close" | "release"; connectionString?: string; command?: WalletCommand };

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function errorDetails(error: unknown) {
  const object = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  return { code: typeof object.code === "string" ? object.code : undefined, message: typeof object.message === "string" ? object.message : "Synthetic harness operation failed" };
}

async function runWorker() {
  assertSimulationRuntime("simulation-only");
  if (!process.send) throw new Error("The PostgreSQL worker requires its parent IPC channel");
  let store: WalletStore | undefined;
  let busy = false;
  const gates = new Map<number, ReturnType<typeof deferred<void>>>();
  process.on("message", (message: Request) => {
    if (message.operation === "release") { gates.get(message.id)?.resolve(); return; }
    if (busy) { process.send!({ id: message.id, kind: "result", ok: false, attempts: 0, error: { message: "Worker already has an active command" } }); return; }
    busy = true;
    void (async () => {
      let attempts = 0;
      try {
        let value: unknown;
        if (message.operation === "init") {
          if (store || !message.connectionString) throw new Error("Invalid worker initialization");
          store = await createPostgresWalletStore({ mode: "simulation-only", connectionString: message.connectionString });
          value = await store.transaction(async tx => (await tx.query("SELECT pg_backend_pid() AS backend")).rows[0]);
        } else if (message.operation === "close") {
          await store?.close();
          value = "closed";
        } else {
          if (!store) throw new Error("Worker has not been initialized");
          let firstAttempt = true;
          const gatedStore: WalletStore = {
            close: () => store!.close(),
            transaction: work => store!.transaction(async tx => {
              attempts++;
              if (message.operation === "race" && firstAttempt) {
                firstAttempt = false;
                // Establish both SERIALIZABLE snapshots before either contender
                // updates the head. The loser must retry the whole transaction.
                await tx.query("SELECT revision FROM alpha_wallet_simulation.head WHERE singleton=true");
                const gate = deferred<void>();
                gates.set(message.id, gate);
                process.send!({ id: message.id, kind: "ready" });
                await gate.promise;
                gates.delete(message.id);
              }
              return work(tx);
            }),
          };
          const wallet = createDurableWallet({ mode: "simulation-only", store: gatedStore, clock: () => FIXTURE_TIME });
          if (message.operation === "recover") value = await wallet.recoverPayouts();
          else {
            if (!message.command) throw new Error("Worker requires an explicit synthetic command");
            value = await wallet.execute(message.command);
          }
        }
        process.send!({ id: message.id, kind: "result", ok: true, value, attempts });
      } catch (error) {
        process.send!({ id: message.id, kind: "result", ok: false, error: errorDetails(error), attempts });
      } finally { busy = false; }
    })();
  });
  process.on("disconnect", () => {
    for (const gate of gates.values()) gate.resolve();
    void store?.close().finally(() => process.exit(0));
    if (!store) process.exit(0);
  });
}

function startWorker() {
  const child: ChildProcess = fork(resolve(process.argv[1]), ["--worker"], {
    execArgv: ["--import", "tsx"],
    env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    serialization: "advanced",
  });
  let sequence = 0;
  const pending = new Map<number, { ready: ReturnType<typeof deferred<void>>; complete: ReturnType<typeof deferred<Reply>>; timer: NodeJS.Timeout; gated: boolean }>();
  child.on("message", (message: Reply | { id: number; kind: "ready" }) => {
    const request = pending.get(message.id);
    if (!request) return;
    if (message.kind === "ready") { request.ready.resolve(); return; }
    clearTimeout(request.timer); pending.delete(message.id);
    if (!message.ok && request.gated) request.ready.reject(new Error(message.error.message));
    request.complete.resolve(message);
  });
  const fail = (error: Error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      if (request.gated) request.ready.reject(error);
      request.complete.reject(error);
    }
    pending.clear();
  };
  child.on("error", fail);
  child.on("exit", (code, signal) => fail(new Error(`PostgreSQL fixture worker exited (${code ?? signal})`)));
  return {
    child,
    request(operation: Request["operation"], data: Pick<Request, "command" | "connectionString"> = {}) {
      const id = ++sequence, ready = deferred<void>(), complete = deferred<Reply>(), gated = operation === "race";
      if (!gated) ready.resolve();
      const timer = setTimeout(() => {
        const error = new Error("PostgreSQL fixture worker exceeded 30 seconds");
        pending.delete(id);
        if (gated) ready.reject(error);
        complete.reject(error);
        child.kill("SIGKILL");
      }, 30_000);
      pending.set(id, { ready, complete, timer, gated });
      child.send({ id, operation, ...data });
      return { ready: ready.promise, complete: complete.promise, release: () => child.send({ id, operation: "release" }) };
    },
    async close() {
      try {
        if (child.connected) {
          const request = this.request("close");
          requireOk(await request.complete);
        }
      } finally { if (child.connected) child.disconnect(); child.kill(); }
    },
  };
}

function requireOk<T = unknown>(reply: Reply): T {
  if (!reply.ok) throw new Error(reply.error.message);
  return reply.value as T;
}

type Worker = ReturnType<typeof startWorker>;
async function race(workers: [Worker, Worker], commands: [WalletCommand, WalletCommand]) {
  const calls = workers.map((worker, index) => worker.request("race", { command: commands[index] }));
  // Observe both completions immediately so worker failure cannot go unhandled
  // while the controller is still waiting for the other snapshot barrier.
  const completed = Promise.all(calls.map(call => call.complete));
  void completed.catch(() => undefined);
  await Promise.all(calls.map(call => call.ready));
  for (const call of calls) call.release();
  const replies = await completed;
  assert(replies.some(reply => reply.attempts >= 2), "Expected a real SERIALIZABLE retry after the shared snapshot barrier");
  return replies;
}

async function controller(connectionString: string) {
  let store = await createPostgresWalletStore({ mode: "simulation-only", connectionString });
  const workers: Worker[] = [];
  const checks: string[] = [];
  try {
    await store.transaction(async tx => {
      const schemas = await tx.query("SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema','public') AND nspname NOT LIKE 'pg_%'");
      const publicRelations = await tx.query<{ count: string }>("SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')");
      assert.equal(schemas.rows.length, 0, "Use a fresh dedicated fixture database; existing schemas are never removed");
      assert.equal(publicRelations.rows[0].count, "0", "Use a fresh fixture database without public relations");
    });
    await initializeDurableWallet(store);
    let wallet = createDurableWallet({ mode: "simulation-only", store, clock: () => FIXTURE_TIME });
    const fixture = durableFixture(wallet), asset = assetFor(TRON), units = (amount: string) => parseUnits(amount, asset.decimals);
    const intent = await fixture.command("createDepositIntent", SELLER, { id: "race-principal", assetId: TRON, purpose: "principal" });
    const listingId = "race-listing";
    await fixture.command("createListing", SELLER, { id: listingId, assetId: TRON, amount: "500", price: "3.20", currency: "ILS" });
    await fixture.command("approveListing", OPERATOR, listingId);
    workers.push(startWorker(), startWorker());
    const initialized = await Promise.all(workers.map(async worker => requireOk<{ backend: number }>(await worker.request("init", { connectionString }).complete)));
    assert.notEqual(initialized[0].backend, initialized[1].backend, "Workers must use independent PostgreSQL backends");
    const pair = workers as [Worker, Worker];

    const event: DepositObservation = { intentId: intent.result.id, assetId: TRON, network: asset.network, token: asset.token,
      transactionId: "sim-tx-race-principal", eventIndex: 0, destination: intent.result.destination,
      amountRaw: units("500").toString(), blockHash: "sim-block-race", finalized: true, successful: true };
    const depositReplies = await race(pair, [walletCommand("observeDeposit", VERIFIER, "race-credit-a", event), walletCommand("observeDeposit", VERIFIER, "race-credit-b", event)]);
    const credited = depositReplies.map(reply => requireOk<DurableExecution<{ credited: boolean }>>(reply).result.credited);
    assert.equal(credited.filter(Boolean).length, 1);
    let state = (await wallet.snapshot()).state;
    assert.equal(expectedCustody(state, TRON), units("500"));
    assert.equal(balance(state, TRON, `listing:${listingId}`), units("500"));
    checks.push("Independent processes credit the same final deposit once");

    const reserve = (suffix: string) => walletCommand("reserveTrade", BUYER, `race-reserve-${suffix}`, { id: `race-trade-${suffix}`, listingId, amount: "300", destination: simulatedDestination(TRON, BUYER.id) });
    const reservations = await race(pair, [reserve("a"), reserve("b")]);
    assert.equal(reservations.filter(reply => reply.ok).length, 1, "Two 300-USDT reservations cannot consume a 500-USDT listing");
    const winner = requireOk<DurableExecution<Trade>>(reservations.find(reply => reply.ok)!).result;
    state = (await wallet.snapshot()).state;
    assert.equal(balance(state, TRON, `listing:${listingId}`), units("200"));
    assert.equal(state.trades.size, 1);
    await fixture.command("reserveTrade", BUYER, { id: "race-trade-remainder", listingId, amount: "200", destination: simulatedDestination(TRON, BUYER.id) });
    checks.push("A forced SERIALIZABLE race prevents overselling; the remaining 200 USDT stays reservable");

    await fixture.command("markBuyerPaid", BUYER, winner.id);
    await fixture.command("verifyPayment", VERIFIER, { tradeId: winner.id, evidence: { reference: "sim-evidence-race", amountMinor: winner.fiatTotalMinor.toString(), currency: "ILS", kind: "simulated-bank-credit" } });
    await fixture.command("authorizeRelease", SELLER, winner.id);
    await fixture.ready();
    const payout = (await fixture.command("queueRelease", DISPATCHER, winner.id)).result;
    const claim = walletCommand("beginDispatch", DISPATCHER, "race-single-dispatch", payout.id);
    const dispatches = await race(pair, [claim, claim]);
    const dispatchResults = dispatches.map(reply => requireOk<DurableExecution<{ shouldDispatch: boolean; payout: Payout }>>(reply));
    assert.equal(dispatchResults.filter(result => result.result.shouldDispatch).length, 1);
    assert.equal(dispatchResults.filter(result => result.replayed).length, 1);
    await fixture.command("recordSubmission", DISPATCHER, { payoutId: payout.id, outcome: "unknown" });
    const recovery = requireOk<Array<{ payout: Payout; action: string }>>(await workers[0].request("recover").complete).find(item => item.payout.id === payout.id)!;
    assert.equal(recovery.action, "lookup_original_reference");
    assert.equal(recovery.payout.providerReference, payout.providerReference);
    assert.equal(recovery.payout.dispatchCount, 1);
    await assert.rejects(wallet.execute(walletCommand("beginDispatch", DISPATCHER, "race-forbidden-new-claim", payout.id)), /already dispatched/);
    checks.push("One dispatch claim wins; unknown submission retains its original reference and funds");

    const receipt = { payoutId: payout.id, providerReference: payout.providerReference, assetId: TRON, network: asset.network, token: asset.token,
      transactionId: "sim-tx-race-payout", eventIndex: 0, destination: payout.destination, amountRaw: payout.amountRaw.toString(), finalized: true, successful: true };
    const receipts = await race(pair, [walletCommand("confirmPayout", VERIFIER, "race-receipt-a", receipt), walletCommand("confirmPayout", VERIFIER, "race-receipt-b", receipt)]);
    for (const reply of receipts) assert.equal(requireOk<DurableExecution<Payout>>(reply).result.state, "confirmed");
    state = (await wallet.snapshot()).state;
    assert.equal(state.receipts.size, 1);
    assert.equal(expectedCustody(state, TRON), units("200"));
    assert.equal(balance(state, TRON, `trade:race-trade-remainder`), units("200"));
    assert.equal(state.commissions.get(winner.id)?.amountRaw, units("6"));
    assert.equal(state.commissions.get(winner.id)?.paid, false);
    assertLedgerInvariants(state);
    checks.push("Competing finalized receipts debit principal once; separate commission due does not consume it");

    // Simulate loss of the client acknowledgement AFTER a real PostgreSQL commit.
    // The driver-level ambiguous network path is covered by transport unit tests.
    let loseAcknowledgement = true;
    const lossyStore: WalletStore = { close: async () => undefined, transaction: async work => {
      const committed = await store.transaction(work);
      if (loseAcknowledgement) { loseAcknowledgement = false; throw new CommitOutcomeUnknownError(new Error("synthetic lost client acknowledgement")); }
      return committed;
    } };
    const lossyWallet = createDurableWallet({ mode: "simulation-only", store: lossyStore, clock: () => FIXTURE_TIME });
    const retryIdentity = walletCommand("createDepositIntent", SELLER, "race-lost-ack", { id: "race-fee-intent", assetId: TRON, purpose: "commission" });
    const beforeLostAck = (await wallet.snapshot()).revision;
    await assert.rejects(lossyWallet.execute(retryIdentity), CommitOutcomeUnknownError);
    const resolved = await wallet.execute(retryIdentity);
    assert.equal(resolved.replayed, true);
    assert.equal((await wallet.snapshot()).revision, beforeLostAck + 1);
    checks.push("Recovery resolves a synthetically lost client acknowledgement by the original command identity");

    const beforeRestart = await wallet.snapshot();
    await store.close();
    store = await createPostgresWalletStore({ mode: "simulation-only", connectionString });
    await initializeDurableWallet(store);
    wallet = createDurableWallet({ mode: "simulation-only", store, clock: () => FIXTURE_TIME });
    const afterRestart = await wallet.snapshot();
    assert.equal(afterRestart.revision, beforeRestart.revision);
    assert.equal(afterRestart.eventHash, beforeRestart.eventHash);
    assert.deepEqual(afterRestart.state, beforeRestart.state);
    checks.push("A new store connection reconstructs identical verified state from committed history");
    console.log(JSON.stringify({ mode: "simulation-only", storage: "real PostgreSQL with two independent Node processes", checks, revision: afterRestart.revision, money: { fundedPrincipalUSDT: "500", buyerReceivedUSDT: "300", remainingReservedUSDT: "200", separateCommissionDueUSDT: "6" } }, null, 2));
  } finally {
    await Promise.allSettled(workers.map(worker => worker.close()));
    await store.close();
  }
}

async function main() {
  if (process.argv.slice(2).join(" ") === "--help") {
    console.log("Development only: NODE_ENV=test node --import tsx scripts/alpha-wallet/postgres-concurrency.ts --fresh-simulation-database --connection-string <explicit loopback alpha_wallet_dev_ URL>. Requires an empty disposable PostgreSQL database. Never reads an environment database URL or drops data.");
    return;
  }
  assertSimulationRuntime("simulation-only");
  if (process.argv[2] === "--worker" && process.argv.length === 3) return runWorker();
  const args = process.argv.slice(2);
  const index = args.indexOf("--connection-string");
  if (args.length !== 3 || !args.includes("--fresh-simulation-database") || index < 0 || !args[index + 1] || args[index + 1].startsWith("--")) {
    throw new Error("Pass --fresh-simulation-database and an explicit --connection-string; see --help");
  }
  await controller(args[index + 1]);
}

void main().catch(error => {
  // Do not print argv, connection options, credentials, or environment variables.
  console.error(`Alpha Wallet PostgreSQL fixture failed: ${errorDetails(error).message}`);
  process.exitCode = 1;
});
