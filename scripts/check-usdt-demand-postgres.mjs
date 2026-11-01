import assert from "node:assert/strict";
import { fork, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { build } from "esbuild";
import pg from "pg";
import { requireAuditDatabaseUrl } from "./integration/audit-database-url.mjs";

const output = path.resolve("work/usdt-postgres-audit");
await mkdir(output, { recursive: true });
const workerFile = path.join(output, "worker.cjs");
await build({ entryPoints: ["scripts/integration/usdt-demand-worker.ts"], outfile: workerFile, bundle: true,
  platform: "node", format: "cjs", packages: "external", tsconfig: "tsconfig.json",
  plugins: [{ name: "isolated-market", setup(plugin) {
    plugin.onResolve({ filter: /(^|\/)market-service$/ }, () => ({ path: path.resolve("scripts/integration/usdt-demand-market.ts") }));
  } }],
  alias: { "server-only": path.resolve("src/test/server-only.ts"),
    "@/lib/postgres-runtime": path.resolve("scripts/integration/postgres-runtime.ts"),
    "@/lib/market-service": path.resolve("scripts/integration/usdt-demand-market.ts"),
    "@alpha-traders/contracts": path.resolve("packages/contracts/src/index.ts") } });
if (process.argv.includes("--build-only")) { console.log("USDT PostgreSQL audit bundled; no database connection."); process.exit(0); }
const target = requireAuditDatabaseUrl(process.env.ALPHA_AUDIT_DATABASE_URL ?? "");
const pool = new pg.Pool({ connectionString: target.toString(), max: 2, application_name: "usdt-isolated-audit", statement_timeout: 15_000 });
const workers = [];
const checks = [];
let sequence = 0;
function startWorker() {
  const child = fork(workerFile, [], { execPath: process.execPath, env: {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: "production",
    ALPHA_AUDIT_DATABASE_URL: target.toString(), ALPHA_AUDIT_WORKER_ID: String(workers.length),
    DATABASE_URL: target.toString(), NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:59999",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "isolated-placeholder", SUPABASE_SERVICE_ROLE_KEY: "isolated-placeholder",
    ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_SECRET: "isolated-ci-synthetic-cardless-key-0001",
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000", ALPHA_USDT_REQUESTS_ENABLED: "0",
    ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED: "0",
  }, stdio: ["ignore", "inherit", "inherit", "ipc"] });
  const pending = new Map();
  child.on("message", message => {
    const task = pending.get(message.id); if (!task) return;
    clearTimeout(task.timer); pending.delete(message.id); task.resolve(message);
  });
  child.on("exit", () => {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error("Isolated worker exited")); }
    pending.clear();
  });
  const worker = { child, call(operation, input) { return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Isolated ${operation} exceeded45s`)); }, 45_000);
    pending.set(id, { resolve, reject, timer }); child.send({ id, operation, input });
  }); } };
  workers.push(worker); return worker;
}
function ok(result) { assert.equal(result.ok, true, `${result.code ?? ""}: ${result.error ?? ""}`); return result.result; }
function passed(name, details = {}) { checks.push({ name, status: "PASS", details }); console.log(`PASS ${name}`); }
const terms = { amount: "1000", price: "3.20", network: "TRC20", paymentMethod: "Bank Transfer", city: "" };
const publish = (userId = "buyer", operationId = randomUUID()) => ({ userId, body: { terms, operationId } });
const offer = (demand, userId) => ({ userId, demandId: demand.id, body: { listingId: `listing-${userId}`, revision: demand.revision, price: "3.10", operationId: randomUUID() } });
function match(demand, response) { return { buyerId: demand.requesterId, actorUserId: demand.requesterId, buyerName: `Private ${demand.requesterId}`,
  listingId: response.listingId, usdtAmount: demand.amount, buyerReceivingWalletAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
  receivingNetwork: "TRC20", paymentMethod: "Bank Transfer", feePolicyVersion: "buyer_seller_1pct_v1",
  usdtDemandId: demand.id, usdtDemandOfferId: response.id, usdtDemandRevision: demand.revision }; }
const count = async () => (await pool.query(`select
  (select count(*)::int from alpha_exchange.usdt_demands) demands,
  (select count(*)::int from alpha_exchange.purchase_requests) trades,
  (select count(*)::int from alpha_exchange.notifications) notices`)).rows[0];
try {
  const existing = (await pool.query("select to_regnamespace('alpha_exchange') is not null as present")).rows[0].present;
  if (existing) {
    assert(process.argv.includes("--reset-fixtures"), "Audit database is not empty; explicit --reset-fixtures required for this dedicated loopback CI database");
    await pool.query("drop schema alpha_exchange cascade");
  }
  await pool.query("do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$");
  const a = startWorker(), b = startWorker();
  const ready = (await Promise.all([a.call("ready"), b.call("ready")])).map(ok);
  assert.notEqual(ready[0].pid, ready[1].pid);
  passed("two cold processes bootstrap atomically with feature OFF");
  assert.equal(ok(await a.call("catalog")).ready, true);
  const migration = await readFile("supabase/migrations/20261024024258_usdt_buy_requests.sql", "utf8");
  await pool.query(migration); await pool.query(migration);
  assert.equal(ok(await b.call("catalog")).ready, true);
  passed("prepared migration applies and repeats on real PostgreSQL17");
  await pool.query("drop index alpha_exchange.idx_usdt_demands_owner; grant select on alpha_exchange.usdt_demands to anon");
  const partial = startWorker();
  ok(await partial.call("ready"));
  assert.deepEqual(ok(await partial.call("catalog")).issues, ["client_privileges", "index_owner"]);
  ok(await partial.call("flag", "on"));
  assert.equal((await partial.call("ready")).ok, false);
  assert.deepEqual(ok(await partial.call("catalog")).issues, ["client_privileges", "index_owner"]);
  await pool.query("create index idx_usdt_demands_owner on alpha_exchange.usdt_demands(requester_id,updated_at desc); revoke all on alpha_exchange.usdt_demands from anon");
  ok(await partial.call("ready"));
  passed("partial existing schema remains usable OFF and fails ON without silent privilege repair");
  const durability = (await pool.query("select name,setting from pg_settings where name in ('fsync','synchronous_commit','full_page_writes') order by name")).rows;
  assert(durability.every(row => row.setting === "on"));
  passed("durability enabled", { settings: durability });
  ok(await a.call("seed"));
  await Promise.all([a.call("flag", "on"), b.call("flag", "on")]);
  const publication = publish();
  const duplicate = (await Promise.all([a.call("publish", publication), b.call("publish", publication)])).map(ok);
  assert.equal(duplicate[0].id, duplicate[1].id); assert.equal((await count()).demands, 1);
  const demand = duplicate[0];
  const blocked = await b.call("publish", publish()); assert.equal(blocked.ok, false);
  passed("publication idempotency and one open demand across processes");
  const responses = (await Promise.all([a.call("offer", offer(demand, "seller")), b.call("offer", offer(demand, "seller-two"))])).map(ok);
  assert.equal(ok(await a.call("snapshot")).usdtDemands[0].offers.length, 2);
  passed("parallel seller responses retained without lost updates");
  const matched = await Promise.all([a.call("match", match(demand, responses[0])), b.call("match", match(demand, responses[1]))]);
  assert.equal(matched.filter(row => row.ok).length, 1);
  assert.equal((await count()).trades, 1);
  const winner = ok(matched.find(row => row.ok));
  const winnerResponse = responses.find(response => response.listingId === winner.request.listingId);
  assert.equal(winner.request.pricePerUsdt, "3.10"); assert.equal(winner.request.fiatAmount, "3131.00");
  passed("competing acceptance has one durable trade at agreed price and buyer fee");
  const restart = startWorker();
  ok(await restart.call("flag", "on"));
  const replay = ok(await restart.call("match", match(demand, winnerResponse)));
  assert.equal(replay.request.id, winner.request.id); assert.equal(replay.replayed, true);
  passed("fresh process replays matched trade without duplicate");
  await a.call("flag", "off");
  assert.equal((await a.call("publish", publish("buyer-two"))).ok, false);
  const room = ok(await a.call("room", { purchaseRequestId: winner.request.id, actorUserId: "buyer", actorRole: "buyer", strongConsistency: true }));
  assert(room);
  passed("feature OFF blocks publication while existing Trade Room remains readable");
  await a.call("flag", "on");
  const beforeFailure = await count();
  await pool.query("alter table alpha_exchange.notifications add constraint audit_failure check(false) not valid");
  const failedBody = publish("buyer-two");
  assert.equal((await a.call("publish", failedBody)).ok, false);
  assert.deepEqual(await count(), beforeFailure);
  await pool.query("alter table alpha_exchange.notifications drop constraint audit_failure");
  const second = ok(await b.call("publish", failedBody));
  assert.equal((await count()).demands, 2);
  passed("failed persistence rolls demand and notices back together; another process retries");
  // A real independent backend holds the same transaction lock as production.
  const locker = await pool.connect();
  await locker.query("begin"); await locker.query("select pg_advisory_xact_lock(61422917)");
  const waiting = b.call("offer", offer(second, "seller"));
  const deadline = Date.now() + 5000; let observedWait = false;
  while (Date.now() < deadline && !observedWait) {
    observedWait = (await pool.query("select exists(select 1 from pg_stat_activity where application_name like 'alpha-audit-worker-%' and wait_event='advisory') as waiting")).rows[0].waiting;
    if (!observedWait) await new Promise(resolve => setTimeout(resolve, 25));
  }
  await locker.query("rollback"); locker.release();
  assert(observedWait); ok(await waiting);
  passed("real PostgreSQL advisory lock serializes writers and releases after rollback");
  const roleClient = await pool.connect();
  try {
    await roleClient.query("begin; grant usage on schema alpha_exchange to anon,authenticated; set role anon");
    await assert.rejects(roleClient.query("select * from alpha_exchange.usdt_demands"), error => error.code === "42501");
    await roleClient.query("rollback");
    await roleClient.query("begin; grant usage on schema alpha_exchange to authenticated; grant select,insert,update on alpha_exchange.usdt_demands to authenticated; set role authenticated");
    assert.equal((await roleClient.query("select * from alpha_exchange.usdt_demands")).rows.length, 0);
    assert.equal((await roleClient.query("update alpha_exchange.usdt_demands set revision=revision+1")).rowCount, 0);
    await roleClient.query("rollback");
  } finally { roleClient.release(true); }
  assert.equal(ok(await a.call("catalog")).ready, true);
  passed("browser roles denied; RLS still hides data after accidental grant");
  const pgBin = process.env.ALPHA_AUDIT_PG_BIN;
  assert(pgBin, "ALPHA_AUDIT_PG_BIN required for actual backup/restore validation");
  const restoreUrl = new URL(target); restoreUrl.pathname = "/alpha_exchange_restore_ci";
  requireAuditDatabaseUrl(restoreUrl.toString(), "alpha_exchange_restore_ci");
  const restore = new pg.Pool({ connectionString: restoreUrl.toString(), max: 1 });
  try {
    if ((await restore.query("select to_regnamespace('alpha_exchange') is not null as present")).rows[0].present) {
      assert(process.argv.includes("--reset-fixtures"), "Restore CI database is not empty");
      await restore.query("drop schema alpha_exchange cascade");
    }
    const archive = path.join(output, "synthetic-usdt.dump");
    const cliEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PGPASSWORD: decodeURIComponent(target.password) };
    const connectionArgs = ["-h", target.hostname, "-p", target.port || "5432", "-U", "postgres"];
    execFileSync(path.join(pgBin, process.platform === "win32" ? "pg_dump.exe" : "pg_dump"), [...connectionArgs, "-d", "alpha_exchange_ci", "-Fc", "-f", archive], { env: cliEnv, windowsHide: true, timeout: 60_000, stdio: "pipe" });
    execFileSync(path.join(pgBin, process.platform === "win32" ? "pg_restore.exe" : "pg_restore"), [...connectionArgs, "-d", "alpha_exchange_restore_ci", "--exit-on-error", archive], { env: cliEnv, windowsHide: true, timeout: 60_000, stdio: "pipe" });
    const digestSql = `select jsonb_build_object('demands',(select jsonb_agg(payload order by id) from alpha_exchange.usdt_demands),
      'trades',(select jsonb_agg(payload order by id) from alpha_exchange.purchase_requests),
      'notifications',(select jsonb_agg(payload order by id) from alpha_exchange.notifications)) as records`;
    const original = (await pool.query(digestSql)).rows[0].records;
    assert.deepEqual((await restore.query(digestSql)).rows[0].records, original);
    assert.equal((await restore.query("select relrowsecurity from pg_class where oid='alpha_exchange.usdt_demands'::regclass")).rows[0].relrowsecurity, true);
    passed("pg_dump/pg_restore preserves exact synthetic records and RLS", { sha256: createHash("sha256").update(JSON.stringify(original)).digest("hex") });
  } finally { await restore.end(); }
  await writeFile(path.join(output, "results.json"), JSON.stringify({ status: "PASS", postgres: (await pool.query("select version() as version")).rows[0].version, checks }, null, 2));
} catch (error) {
  await writeFile(path.join(output, "results.json"), JSON.stringify({ status: "FAIL", checks, error: error instanceof Error ? error.message : String(error) }, null, 2));
  throw error;
} finally {
  for (const worker of workers) worker.child.kill();
  await pool.end();
}
