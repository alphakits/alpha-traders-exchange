import { Pool } from "pg";
import { discoverCommissionHistory, postgresCommissionHistoryStore } from "../../src/lib/commission-deposit-history";
import { scanBep20CommissionDeposits, scanBinanceCommissionDeposits, scanTronCommissionDeposits } from "../../src/lib/commission-deposit-discovery";

// This worker is bundled only by the disposable PostgreSQL acceptance harness.
// It cannot use the application's connection string or reach a live provider.
const connectionString = process.env.ALPHA_AUDIT_DATABASE_URL ?? "";
const database = new URL(connectionString);
if (!["127.0.0.1", "localhost"].includes(database.hostname)
  || database.pathname !== "/alpha_exchange_ci" || database.username !== "postgres") {
  throw new Error("History recovery requires the dedicated loopback CI database.");
}
const fixture = new URL(process.env.ALPHA_AUDIT_PROVIDER_ORIGIN ?? "");
if (fixture.protocol !== "http:" || fixture.hostname !== "127.0.0.1" || !fixture.port
  || fixture.username || fixture.password || fixture.pathname !== "/" || fixture.search || fixture.hash) {
  throw new Error("History recovery requires a loopback provider fixture.");
}
const pool = new Pool({ connectionString, max: 1, application_name: "alpha-history-recovery-fixture",
  connectionTimeoutMillis: 5_000, statement_timeout: 10_000, query_timeout: 12_000 });
const nativeFetch = globalThis.fetch;
const providers = new Map([
  ["https://api.trongrid.io", "trongrid"],
  ["https://api.etherscan.io", "etherscan"],
  ["https://api.binance.com", "binance"],
]);
globalThis.fetch = async (input, init) => {
  const original = new URL(input instanceof Request ? input.url : String(input));
  const provider = providers.get(original.origin);
  if (!provider || original.username || original.password) throw new Error("Non-fixture HTTP is forbidden in history recovery");
  const local = new URL(`/${provider}${original.pathname}${original.search}`, fixture);
  return nativeFetch(local, { ...init, redirect: "error" });
};

type Command = { type: "run"; now: number; since: number; pause?: "before-save" | "after-save" };
let resume: (() => void) | undefined;
let started = false;
async function checkpoint(stage: string, pause: Command["pause"]) {
  if (pause !== stage) return;
  const barrier = new Promise<void>(resolve => { resume = resolve; });
  process.send?.({ type: "checkpoint", stage });
  await barrier;
}
process.on("message", async (message: Command | { type: "resume" }) => {
  if (message.type === "resume") { resume?.(); return; }
  if (started) return;
  started = true;
  try {
    const store = postgresCommissionHistoryStore(pool);
    const result = await discoverCommissionHistory({ scope: "checkout", since: message.since, now: message.now,
      networks: ["TRC20", "BEP20"],
      store: { load: store.load, async save(scope, version, state) {
        await checkpoint("before-save", message.pause);
        const committed = await store.save(scope, version, state);
        await checkpoint("after-save", message.pause);
        return committed;
      } },
      scanners: { TRC20: scanTronCommissionDeposits, BEP20: scanBep20CommissionDeposits, BINANCE_DEPOSITS: scanBinanceCommissionDeposits },
    });
    await pool.end();
    process.send?.({ type: "result", ok: true, result });
  } catch (error) {
    await pool.end().catch(() => undefined);
    process.send?.({ type: "result", ok: false, error: error instanceof Error ? error.message : "Unknown history failure" });
    process.exitCode = 1;
  } finally {
    process.disconnect?.();
  }
});
process.send?.({ type: "ready", pid: process.pid });
