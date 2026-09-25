/* Offline checks. Wire tests use installed pg against a loopback-only protocol
 * fixture, never production credentials/data. No Supabase performance claim.
 * --unit-only is for local environments without the installed project driver.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => fs.readFileSync(root + path, "utf8");
const source = read("src/lib/postgres-timeout-guard.ts");
const output = ts.transpileModule(source, { fileName: "postgres-timeout-guard.ts", reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
assert.equal(output.diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
const module = { exports: {} };
vm.runInNewContext(output.outputText, { module, exports: module.exports });
const { installPostgresTimeoutGuard: install } = module.exports;
const timeout = () => new Error("Query read timeout");
function fake(query, end = () => Promise.resolve()) {
  const client = { calls: 0, closes: 0, query(...args) { this.calls++; return query.apply(this, args); },
    end() { this.closes++; return end(); } };
  install(client); return client;
}

test("promise success preserves result and arguments without closing", async () => {
  const rows = { rows: [{ value: 1 }] }, values = ["fixture"];
  const client = fake(function (sql, input) { assert.equal(sql, "select $1"); assert.equal(input, values); return Promise.resolve(rows); });
  assert.equal(await client.query("select $1", values), rows);
  assert.equal(client.closes, 0); assert.equal(client.calls, 1);
});
test("promise read timeout retires before rejection and never retries", async () => {
  const error = timeout(), client = fake(() => Promise.reject(error));
  await assert.rejects(client.query("select fixture"), (actual) => actual === error && client.closes === 1);
  assert.equal(client.calls, 1);
});
for (const kind of ["two", "three", "config"]) test(`${kind}-argument callback keeps original error and fires once`, async () => {
  const error = timeout(); let called = 0;
  const client = fake((...args) => { const callback = typeof args.at(-1) === "function" ? args.at(-1) : args[0].callback;
    queueMicrotask(() => callback(error)); return undefined; });
  let originalConfig;
  await new Promise((resolve, reject) => {
    const callback = (actual) => { try { called++; assert.equal(actual, error); assert.equal(client.closes, 1); resolve(); } catch (e) { reject(e); } };
    if (kind === "two") assert.equal(client.query("select fixture", callback), undefined);
    if (kind === "three") assert.equal(client.query("select fixture", [1], callback), undefined);
    if (kind === "config") { originalConfig = { text: "select fixture", callback }; client.query(originalConfig); assert.equal(originalConfig.callback, callback); }
  });
  assert.equal(called, 1); assert.equal(client.calls, 1);
});
for (const code of ["57014", "23505", "42501", "25P02"]) test(`server SQL error ${code} remains available for normal rollback`, async () => {
  const error = Object.assign(new Error("server error"), { code }), client = fake(() => Promise.reject(error));
  await assert.rejects(client.query("fixture"), (actual) => actual === error); assert.equal(client.closes, 0);
});
test("successful callback result and receiver are preserved", () => {
  const receiver = {}, rows = { rows: [] }; let calls = 0;
  const client = fake((_, callback) => callback.call(receiver, null, rows));
  client.query("select fixture", function (error, result) { calls++; assert.equal(this, receiver); assert.equal(error, null); assert.equal(result, rows); });
  assert.equal(calls, 1); assert.equal(client.closes, 0);
});
test("installing twice does not stack query wrappers", () => {
  const client = fake(() => Promise.resolve({ rows: [] })), query = client.query;
  install(client); assert.equal(client.query, query);
});
test("concurrent timeout rejections close their shared client only once", async () => {
  const client = fake(() => Promise.reject(timeout()));
  const values = await Promise.allSettled([client.query("first"), client.query("second")]);
  assert.ok(values.every((value) => value.status === "rejected")); assert.equal(client.closes, 1);
});
for (const synchronous of [true, false]) test(`shutdown failure does not replace timeout (${synchronous ? "sync" : "async"})`, async () => {
  const error = timeout(), client = fake(() => Promise.reject(error), () => { if (synchronous) throw new Error("shutdown"); return Promise.reject(new Error("shutdown")); });
  await assert.rejects(client.query("fixture"), (actual) => actual === error);
});
test("synchronous argument errors and custom Submittable identity remain unchanged", () => {
  const error = new TypeError("invalid input"), client = fake(() => { throw error; });
  assert.throws(() => client.query(null), (actual) => actual === error); assert.equal(client.closes, 0);
  const custom = { submit() {} }, other = fake((config) => config);
  assert.equal(other.query(custom), custom);
});

const unitOnly = process.argv.includes("--unit-only");
if (!unitOnly) {
  const { Pool } = createRequire(import.meta.url)("pg");
  const i16 = (value) => { const b = Buffer.alloc(2); b.writeInt16BE(value); return b; };
  const i32 = (value) => { const b = Buffer.alloc(4); b.writeInt32BE(value); return b; };
  const packet = (type, ...body) => { const data = Buffer.concat(body); return Buffer.concat([Buffer.from(type), i32(data.length + 4), data]); };
  const cstring = (text) => Buffer.from(text + "\0");
  async function fixture(t, { guard = true, stallCommit = false, max = 1 } = {}) {
    const sockets = new Set(), observed = [], closed = new Set(); let serial = 0;
    const server = createServer((socket) => {
      const id = ++serial; sockets.add(socket); let pending = Buffer.alloc(0), startup = true, state = "I";
      socket.on("error", () => {}); socket.on("close", () => { sockets.delete(socket); closed.add(id); });
      const ready = () => packet("Z", Buffer.from(state));
      const complete = (tag) => socket.write(Buffer.concat([packet("C", cstring(tag)), ready()]));
      socket.on("data", (bytes) => {
        pending = Buffer.concat([pending, bytes]);
        for (;;) {
          if (startup) {
            if (pending.length < 4 || pending.length < pending.readInt32BE(0)) return;
            const length = pending.readInt32BE(0); pending = pending.subarray(length); startup = false;
            socket.write(Buffer.concat([packet("R", i32(0)), packet("S", cstring("server_version"), cstring("17.0")),
              packet("K", i32(id), i32(1)), ready()]));
          } else {
            if (pending.length < 5 || pending.length < pending.readInt32BE(1) + 1) return;
            const type = String.fromCharCode(pending[0]), length = pending.readInt32BE(1) + 1;
            const body = pending.subarray(5, length); pending = pending.subarray(length);
            if (type === "X") { socket.end(); return; }
            if (type !== "Q") { socket.destroy(new Error("Unexpected fixture protocol message")); return; }
            const sql = body.toString("utf8").replace(/\0$/, ""); observed.push({ id, sql });
            if (sql === "SELECT STALL" || (sql === "COMMIT" && stallCommit)) continue;
            if (sql === "BEGIN") { state = "T"; complete("BEGIN"); continue; }
            if (sql === "ROLLBACK" || sql === "COMMIT") { state = "I"; complete(sql); continue; }
            if (sql === "SELECT SERVER_TIMEOUT") {
              state = "E"; socket.write(Buffer.concat([packet("E", cstring("SERROR"), cstring("C57014"), cstring("Mstatement canceled"), Buffer.from([0])), ready()])); continue;
            }
            socket.write(Buffer.concat([packet("T", i16(1), cstring("value"), i32(0), i16(0), i32(23), i16(4), i32(-1), i16(0)),
              packet("D", i16(1), i32(1), Buffer.from("1")), packet("C", cstring("SELECT 1")), ready()]));
          }
        }
      });
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const pool = new Pool({ host: "127.0.0.1", port: server.address().port, user: "fixture", password: "fixture",
      database: "fixture", ssl: false, max, connectionTimeoutMillis: 1500, idleTimeoutMillis: 1000, query_timeout: 150 });
    pool.on("error", () => {}); if (guard) pool.on("connect", install);
    t.after(async () => { for (const socket of sockets) socket.destroy(); await pool.end(); await new Promise((resolve) => server.close(resolve)); });
    return { pool, sockets, observed, closed };
  }
  const eventually = async (check) => { const until = Date.now() + 1000; while (!check() && Date.now() < until) await new Promise((r) => setTimeout(r, 10)); assert.ok(check()); };
  test("unmodified pg reproduces an open checked-out socket after a read timeout", { timeout: 4000 }, async (t) => {
    const f = await fixture(t, { guard: false }), client = await f.pool.connect();
    try { await assert.rejects(client.query("SELECT STALL"), /Query read timeout/); assert.equal(f.closed.size, 0); assert.equal(f.pool.idleCount, 0); }
    finally { client.release(true); }
  });
  test("guarded checked-out timeout closes the stalled socket and replaces the client", { timeout: 4000 }, async (t) => {
    const f = await fixture(t), client = await f.pool.connect();
    try { await assert.rejects(client.query("SELECT STALL"), /Query read timeout/); await eventually(() => f.closed.size === 1); }
    finally { client.release(); }
    assert.equal((await f.pool.query("SELECT 1")).rows[0].value, 1);
    assert.equal(f.observed.filter((row) => row.sql === "SELECT STALL").length, 1);
    assert.notEqual(f.observed[0].id, f.observed.at(-1).id);
  });
  test("pool.query timeout frees capacity for an already queued healthy read", { timeout: 4000 }, async (t) => {
    const f = await fixture(t), failed = assert.rejects(f.pool.query("SELECT STALL"), /Query read timeout/);
    const healthy = f.pool.query("SELECT 1"); await failed; assert.equal((await healthy).rows[0].value, 1); assert.equal(f.pool.waitingCount, 0);
  });
  test("a healthy concurrent client survives another client's timeout", { timeout: 4000 }, async (t) => {
    const f = await fixture(t, { max: 2 }), stalled = await f.pool.connect(), healthy = await f.pool.connect();
    try {
      const failed = assert.rejects(stalled.query("SELECT STALL"), /Query read timeout/);
      assert.equal((await healthy.query("SELECT 1")).rows[0].value, 1); await failed;
      assert.equal((await healthy.query("SELECT 1")).rows[0].value, 1);
      const ids = f.observed.filter((row) => row.sql === "SELECT 1").map((row) => row.id); assert.equal(ids[0], ids[1]);
    } finally { stalled.release(); healthy.release(); }
  });
  test("transaction timeout cannot send queued rollback or a subsequent commit", { timeout: 4000 }, async (t) => {
    const f = await fixture(t), client = await f.pool.connect();
    try { await client.query("BEGIN"); await assert.rejects(client.query("SELECT STALL"), /Query read timeout/);
      await assert.rejects(client.query("ROLLBACK")); await assert.rejects(client.query("COMMIT"));
      assert.deepEqual(f.observed.map((row) => row.sql), ["BEGIN", "SELECT STALL"]);
    } finally { client.release(); }
  });
  test("COMMIT response timeout stays a failure with no replay or fabricated success", { timeout: 4000 }, async (t) => {
    const f = await fixture(t, { stallCommit: true }), client = await f.pool.connect();
    try { await client.query("BEGIN"); await client.query("SELECT 1"); await assert.rejects(client.query("COMMIT"), /Query read timeout/); }
    finally { client.release(); }
    assert.equal(f.observed.filter((row) => row.sql === "COMMIT").length, 1);
  });
  test("server statement timeout still permits normal rollback and healthy reuse", { timeout: 4000 }, async (t) => {
    const f = await fixture(t), client = await f.pool.connect();
    try { await client.query("BEGIN"); await assert.rejects(client.query("SELECT SERVER_TIMEOUT"), (e) => e.code === "57014");
      await client.query("ROLLBACK"); assert.equal((await client.query("SELECT 1")).rows[0].value, 1); assert.equal(f.closed.size, 0);
    } finally { client.release(); }
  });
  test("successful transactions retain query order and stay on one connection", { timeout: 4000 }, async (t) => {
    const f = await fixture(t), client = await f.pool.connect();
    try { await client.query("BEGIN"); await client.query("SELECT 1"); await client.query("COMMIT"); }
    finally { client.release(); }
    assert.deepEqual(f.observed.map((row) => row.sql), ["BEGIN", "SELECT 1", "COMMIT"]);
    assert.equal(new Set(f.observed.map((row) => row.id)).size, 1); assert.equal(f.closed.size, 0);
  });
  test("actual pg callback timeout is returned once and retires its socket", { timeout: 4000 }, async (t) => {
    const f = await fixture(t), client = await f.pool.connect(); let callbacks = 0;
    try { await new Promise((resolve, reject) => client.query("SELECT STALL", (error) => {
      callbacks++; try { assert.match(error.message, /Query read timeout/); resolve(); } catch (e) { reject(e); }
    })); await eventually(() => f.closed.size === 1); assert.equal(callbacks, 1); }
    finally { client.release(); }
  });
  test("production wiring preserves pool/TLS/timeouts and existing validation gates", () => {
    const runtime = read("src/lib/postgres-runtime.ts");
    assert.match(runtime, /pool\.on\("connect", installPostgresTimeoutGuard\)/);
    for (const contract of [/max: 5/, /rejectUnauthorized: true/, /attachDatabasePool\(pool\)/, /statement_timeout: 10_000/, /query_timeout: 12_000/]) assert.match(runtime, contract);
    const { scripts } = JSON.parse(read("package.json"));
    assert.match(scripts.build, /test:db-runtime/); assert.match(scripts.build, /test:seo-discovery/); assert.match(scripts.build, /test:owner-analytics/);
  });
}
