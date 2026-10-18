import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { build } from "esbuild";
import pg from "pg";

const output = path.resolve("test-results/postgres-concurrency/history-recovery.json");
const workerFile = path.resolve("tmp/postgres-audit/history-worker.cjs");
const buildOnly = process.argv.includes("--build-only");
const connectionString = process.env.ALPHA_AUDIT_DATABASE_URL ?? "";
if (!buildOnly) {
  const target = new URL(connectionString);
  assert(["localhost", "127.0.0.1"].includes(target.hostname)
    && target.pathname === "/alpha_exchange_ci" && target.username === "postgres", "Dedicated loopback database required");
}
await build({ entryPoints: ["scripts/integration/commission-history-worker.ts"], outfile: workerFile,
  bundle: true, platform: "node", format: "cjs", packages: "external", tsconfig: "tsconfig.json",
  alias: { "server-only": path.resolve("src/test/server-only.ts") } });
if (buildOnly) { console.log("History recovery worker bundled; no database or provider calls executed."); process.exit(0); }

const pool = new pg.Pool({ connectionString, max: 2, application_name: "alpha-history-recovery-controller" });
const checks = [];
const requests = [];
const processes = [];
const fixtureErrors = [];
const fixtureKey = "isolated-history-fixture-key";
const fixtureSecret = "isolated-history-fixture-secret";
let tronWallet;
let tronContract;
let mode = "long";
let phase = "initial";
let failTronOnce = false;
let bepWallet;
let bepContract;
let originalRows;

function passed(name, details) {
  checks.push({ name, status: "PASS", details });
  console.log(`PASS ${name}: ${JSON.stringify(details)}`);
}
function tronRow(competing = false) {
  return { transaction_id: (competing ? "b" : "a").repeat(64), from: "synthetic-payer", to: tronWallet,
    type: "Transfer", value: competing ? "102000000" : "100000000", block_timestamp: 100_000,
    token_info: { address: tronContract, decimals: 6 } };
}
function bepRow(competing = false) {
  return { hash: `0x${(competing ? "b" : "a").repeat(64)}`, from: "synthetic-payer", to: bepWallet,
    contractAddress: bepContract, value: competing ? "102000000000000000000" : "100000000000000000000",
    timeStamp: "100", tokenDecimal: "18" };
}
function binanceRow(competing = false) {
  return { id: competing ? "102" : "101", coin: "USDT", status: 1, transferType: 1, travelRuleStatus: 0,
    network: competing ? "BSC" : "TRX", address: competing ? bepWallet : tronWallet,
    amount: competing ? "102.000000" : "100.000000", insertTime: 100_000, txId: "synthetic-internal-credit" };
}
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const send = (body, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
  try {
    assert.equal(request.method, "GET");
    if (url.pathname.startsWith("/trongrid/")) {
      assert.equal(url.pathname, `/trongrid/v1/accounts/${tronWallet}/transactions/trc20`);
      assert.equal(request.headers["tron-pro-api-key"], fixtureKey);
      assert.equal(url.searchParams.get("contract_address"), tronContract);
      assert.equal(url.searchParams.get("only_confirmed"), "true");
      assert.equal(url.searchParams.get("only_to"), "true");
      const page = Number(url.searchParams.get("fingerprint") ?? 0);
      const since = Number(url.searchParams.get("min_timestamp"));
      const until = Number(url.searchParams.get("max_timestamp"));
      requests.push({ phase, provider: "TRC20", page, since, until });
      if (failTronOnce) { failTronOnce = false; send({ success: false }, 503); return; }
      const historical = since <= 100_000;
      const data = historical && (mode === "fresh" || page < 6) ? [tronRow(page === 5)] : [];
      send({ success: true, data, ...(historical && mode === "long" && page < 6 ? { meta: { fingerprint: String(page + 1) } } : {}) });
      return;
    }
    if (url.pathname === "/etherscan/v2/api") {
      assert.equal(url.searchParams.get("apikey"), fixtureKey);
      assert.equal(url.searchParams.get("chainid"), "56");
      if (url.searchParams.get("action") === "getblocknobytime") {
        const timestamp = Number(url.searchParams.get("timestamp"));
        requests.push({ phase, provider: "BEP20_BLOCK", timestamp });
        send({ status: "1", result: String(4000 + timestamp) }); return;
      }
      assert.equal(url.searchParams.get("action"), "tokentx");
      assert.equal(url.searchParams.get("address"), bepWallet);
      assert.equal(url.searchParams.get("contractaddress"), bepContract);
      assert.equal(url.searchParams.get("sort"), "desc");
      const page = Number(url.searchParams.get("page"));
      const endBlock = url.searchParams.get("endblock");
      requests.push({ phase, provider: "BEP20", page, endBlock });
      // The catch-up window starts after the fixture's single historical block.
      const catchup = phase === "catch-up";
      const rows = catchup || (mode === "long" && page > 6) ? []
        : Array.from({ length: mode === "long" ? 200 : 1 }, () => bepRow(page === 6));
      send(rows.length ? { status: "1", result: rows } : { status: "0", message: "No transactions found", result: [] }); return;
    }
    if (url.pathname === "/binance/sapi/v1/capital/deposit/hisrec") {
      assert.equal(request.headers["x-mbx-apikey"], fixtureKey);
      const signature = url.searchParams.get("signature");
      const unsigned = new URLSearchParams(url.searchParams); unsigned.delete("signature");
      assert.equal(signature, createHmac("sha256", fixtureSecret).update(unsigned.toString()).digest("hex"));
      assert.equal(url.searchParams.get("coin"), "USDT");
      assert.equal(url.searchParams.get("status"), "1");
      const offset = Number(url.searchParams.get("offset"));
      const since = Number(url.searchParams.get("startTime"));
      const until = Number(url.searchParams.get("endTime"));
      requests.push({ phase, provider: "BINANCE_DEPOSITS", offset, since, until });
      const rows = since > 100_000 ? [] : mode === "fresh" ? [binanceRow()]
        : offset < 1000 ? Array.from({ length: 200 }, () => binanceRow()) : [binanceRow(true)];
      send(rows); return;
    }
    throw new Error("Unexpected fixture request");
  } catch (error) {
    // The synthetic fixture never retains credential headers or signed URLs.
    fixtureErrors.push({ phase, message: error.message });
    send({ error: "fixture_contract_failed" }, 500);
  }
});

function worker(origin) {
  const child = fork(workerFile, [], { env: { PATH: process.env.PATH, NODE_ENV: "production",
    ALPHA_AUDIT_DATABASE_URL: connectionString, ALPHA_AUDIT_PROVIDER_ORIGIN: origin,
    ALPHA_EXCHANGE_TRONGRID_API_KEY: fixtureKey, ALPHA_EXCHANGE_ETHERSCAN_API_KEY: fixtureKey,
    ALPHA_EXCHANGE_BINANCE_READ_API_KEY: fixtureKey, ALPHA_EXCHANGE_BINANCE_READ_API_SECRET: fixtureSecret },
    stdio: ["ignore", "inherit", "inherit", "ipc"] });
  const events = [];
  const listeners = new Set();
  const push = event => { events.push(event); for (const listener of listeners) listener(event); };
  child.on("message", push);
  child.on("error", error => push({ type: "exit", code: null, signal: null, error: error.message }));
  child.on("exit", (code, signal) => push({ type: "exit", code, signal }));
  const item = { child, events, wait(type) {
    const matching = event => event.type === type || event.type === "exit";
    const existing = events.find(matching);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(listener); reject(new Error(`History worker ${type} exceeded 30 seconds`)); }, 30_000);
      const listener = event => { if (matching(event)) { clearTimeout(timer); listeners.delete(listener); resolve(event); } };
      listeners.add(listener);
    });
  } };
  processes.push(item);
  return item;
}
async function start(origin, now, pause) {
  const item = worker(origin);
  assert.equal((await item.wait("ready")).type, "ready");
  item.child.send({ type: "run", since: 50_000, now, pause });
  return item;
}
async function finish(item) {
  const message = await item.wait("result");
  assert.equal(message.type, "result", "History worker exited before returning a result");
  assert.equal(message.ok, true, message.error);
  assert.equal((await item.wait("exit")).code, 0);
  return message.result;
}
async function run(origin, now) { return finish(await start(origin, now)); }
async function saved() {
  const rows = (await pool.query("SELECT version::int, payload FROM alpha_exchange.commission_deposit_scan_progress WHERE scope='checkout'")).rows;
  return rows[0] ?? null;
}
async function reset() {
  await pool.query("DELETE FROM alpha_exchange.commission_deposit_scan_progress WHERE scope='checkout'");
}
async function stopAt(item, stage) {
  const observed = await item.wait("checkpoint");
  assert.deepEqual(observed, { type: "checkpoint", stage });
  assert.equal(item.events.some(event => event.type === "result"), false);
  item.child.kill("SIGKILL");
  assert.equal((await item.wait("exit")).signal, "SIGKILL");
  assert.equal(item.events.some(event => event.type === "result"), false);
}
try {
  // Import the repository's pinned public destinations into the local fixture.
  // No provider secrets are imported from the application environment.
  const config = await readFile("src/lib/commission-config.ts", "utf8");
  const configured = name => {
    const value = config.match(new RegExp(`export const ${name}\\s*=\\s*"([^"]+)"`))?.[1];
    assert(value, `Missing canonical fixture constant: ${name}`);
    return value;
  };
  tronWallet = configured("CANONICAL_TRC20_COMMISSION_WALLET");
  tronContract = configured("OFFICIAL_TRON_USDT_CONTRACT");
  bepWallet = configured("CANONICAL_BEP20_COMMISSION_WALLET");
  bepContract = configured("BSC_USDT_CONTRACT");
  originalRows = (await pool.query("SELECT scope,version,payload,updated_at FROM alpha_exchange.commission_deposit_scan_progress ORDER BY scope")).rows;
  assert.equal(originalRows.length, 0, "History fixture requires empty disposable progress storage");
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}/`;
  let result = await run(origin, 1_000_000);
  assert.equal(result.complete, false); assert.deepEqual(result.deposits, []); assert.equal(result.pages, 15);
  const initial = await saved();
  assert.equal(initial.version, 1);
  assert.equal(initial.payload.providers.TRC20.progress.fingerprint, "5");
  assert.deepEqual(initial.payload.providers.BEP20.progress, { until: 1_000_000, page: 6, endBlock: "5000" });
  assert.deepEqual(initial.payload.providers.BINANCE_DEPOSITS.progress, { until: 1_000_000, windowEnd: 1_000_000, offset: 1000 });
  passed("All three real scanner adapters persist their five-page continuation before process exit", { providers: 3, pages: 15, releasedReceipts: 0 });

  phase = "provider-outage"; failTronOnce = true;
  result = await run(origin, 1_001_000);
  assert.equal(result.complete, false); assert.deepEqual(result.deposits, []);
  assert.equal(result.providers.TRC20.error, "tron_http_503");
  const outage = await saved();
  assert.equal(outage.version, 2);
  assert.deepEqual(outage.payload.providers.TRC20.progress, initial.payload.providers.TRC20.progress);
  assert.equal(outage.payload.providers.BEP20.complete, true);
  assert.equal(outage.payload.providers.BINANCE_DEPOSITS.complete, true);
  assert.equal(requests.some(row => row.phase === phase && row.provider === "BEP20_BLOCK"), false);
  assert.deepEqual(requests.find(row => row.phase === phase && row.provider === "BEP20"), { phase, provider: "BEP20", page: 6, endBlock: "5000" });
  assert.equal(requests.find(row => row.phase === phase && row.provider === "BINANCE_DEPOSITS").offset, 1000);
  passed("A restarted worker preserves the interrupted cursor through a real HTTP 503", { checkpointVersion: 2, releasedReceipts: 0, completedProvidersRetained: 2 });

  phase = "resume";
  result = await run(origin, 1_002_000);
  assert.equal(result.complete, false); assert.deepEqual(result.deposits, []);
  assert.deepEqual(requests.filter(row => row.phase === phase).map(row => row.provider), ["TRC20", "TRC20"]);
  assert.equal((await saved()).payload.until, 0);
  phase = "catch-up";
  result = await run(origin, 1_003_000);
  assert.equal(result.complete, true); assert.equal(result.deposits.length, 6);
  assert.equal(new Set(result.deposits.map(row => `${row.network}:${row.signature}`)).size, 6);
  assert.equal(requests.find(row => row.phase === phase && row.provider === "TRC20").since, 999_000);
  assert.equal((await saved()).payload.consumed, true);
  passed("Independent workers resume every cursor and complete fresh catch-up before releasing history", { processes: 4, distinctReceipts: 6, duplicateObservationsRemoved: true });

  phase = "next-full-cycle";
  result = await run(origin, 1_004_000);
  assert.equal(result.complete, false); assert.deepEqual(result.deposits, []);
  assert.equal(requests.find(row => row.phase === phase && row.provider === "TRC20").since, 50_000);
  assert.equal(requests.find(row => row.phase === phase && row.provider === "TRC20").page, 0);
  assert.equal(requests.find(row => row.phase === phase && row.provider === "BEP20").page, 1);
  assert.equal(requests.find(row => row.phase === phase && row.provider === "BINANCE_DEPOSITS").offset, 0);
  passed("A completed cycle starts a full observation again for late-indexed receipts", { providers: 3 });

  await reset(); mode = "fresh"; phase = "crash-before-save";
  const before = await start(origin, 2_000_000, "before-save");
  await stopAt(before, "before-save");
  assert.equal(await saved(), null);
  result = await run(origin, 2_001_000);
  assert.equal(result.complete, true); assert.equal(result.deposits.length, 3); assert.equal((await saved()).version, 1);
  passed("SIGKILL before checkpoint persistence cannot advance progress or publish receipts", { killedProcesses: 1, recoveredReceipts: 3, checkpointVersion: 1 });

  await reset(); phase = "crash-after-save";
  const after = await start(origin, 3_000_000, "after-save");
  await stopAt(after, "after-save");
  const committed = await saved();
  assert.equal(committed.version, 1); assert.equal(committed.payload.consumed, true);
  result = await run(origin, 3_001_000);
  assert.equal(result.complete, true); assert.equal(result.deposits.length, 3); assert.equal((await saved()).version, 2);
  passed("SIGKILL after commit but before publication reobserves receipts on restart", { killedProcesses: 1, recoveredReceipts: 3, checkpointVersion: 2, settlementPerformed: false });

  await reset(); phase = "concurrent-publication";
  const contenders = await Promise.all([start(origin, 4_000_000, "before-save"), start(origin, 4_000_000, "before-save")]);
  for (const contender of contenders) assert.deepEqual(await contender.wait("checkpoint"), { type: "checkpoint", stage: "before-save" });
  assert.equal(await saved(), null);
  for (const contender of contenders) contender.child.send({ type: "resume" });
  const results = await Promise.all(contenders.map(finish));
  assert.equal(results.filter(row => row.complete).length, 1);
  assert.equal(results.filter(row => row.checkpointConflict).length, 1);
  assert.equal(results.reduce((total, row) => total + row.deposits.length, 0), 3);
  assert.equal((await saved()).version, 1);
  passed("Two independent processes can publish only one committed receiving-history result", { workers: 2, winners: 1, losingWorkerReceipts: 0 });
  assert.deepEqual(fixtureErrors, []);
  await reset();
  assert.deepEqual((await pool.query("SELECT scope,version,payload,updated_at FROM alpha_exchange.commission_deposit_scan_progress ORDER BY scope")).rows, originalRows);
  passed("The disposable history fixture leaves its database state unchanged", { retainedRows: 0, liveProviderCalls: 0, customerAccountsUsed: 0 });
} catch (error) {
  checks.push({ name: "History process recovery", status: "FAIL", error: error.stack ?? String(error) });
  console.error(error); process.exitCode = 1;
} finally {
  for (const item of processes) if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill("SIGKILL");
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await pool.end();
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ commit: process.env.GITHUB_SHA ?? null,
    scope: "Real PostgreSQL, separate Node processes and actual scanner adapters against a loopback HTTP fixture. Synthetic deposits only; no live provider, account, payment or settlement acceptance.",
    checks, processCount: processes.length, requests, fixtureErrors }, null, 2));
}
