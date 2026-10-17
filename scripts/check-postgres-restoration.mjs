import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import pg from "pg";

const target = new URL(process.env.ALPHA_AUDIT_DATABASE_URL ?? "");
assert(["127.0.0.1", "localhost"].includes(target.hostname) && target.pathname === "/alpha_exchange_ci" && target.username === "postgres", "Dedicated loopback database required");
const original = new pg.Client({ connectionString: target.toString() });
target.pathname = "/alpha_exchange_restore_ci";
const restored = new pg.Client({ connectionString: target.toString() });
const report = { scope: "Controlled CI runtime database; no production backup or hosted-provider recovery is certified", checks: [] };
async function fingerprints(client) {
  const tables = await client.query("select tablename from pg_tables where schemaname='alpha_exchange' order by tablename");
  const result = [];
  for (const { tablename } of tables.rows) {
    const name = `alpha_exchange."${tablename.replaceAll('"', '""')}"`;
    const rows = await client.query(`select count(*)::int as rows, md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by md5(to_jsonb(t)::text)), '')) as fingerprint from ${name} t`);
    result.push({ table: tablename, ...rows.rows[0] });
  }
  return result;
}
try {
  await original.connect(); await restored.connect();
  await original.query("begin read only");
  const expected = await fingerprints(original);
  const recovered = await fingerprints(restored);
  assert(expected.length > 20, "Expected real runtime schema");
  assert.deepEqual(recovered, expected);
  report.tables = expected;
  report.checks.push({ name: "Restored row counts and deterministic contents match every runtime table", status: "PASS", tables: expected.length });
  const shape = "select c.relname as table_name, x.conname, pg_get_constraintdef(x.oid) as definition from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='alpha_exchange' order by c.relname,x.conname";
  const constraints = (await original.query(shape)).rows;
  assert.deepEqual((await restored.query(shape)).rows, constraints);
  report.checks.push({ name: "Primary, foreign-key, unique and check constraints survive restoration", status: "PASS", constraints: constraints.length });
  await restored.query("begin");
  const changed = await restored.query("update alpha_exchange.listings set payload=jsonb_set(payload, '{availableAmount}', '\"0\"') where id='audit-listing-0'");
  assert.equal(changed.rowCount, 1);
  assert.notDeepEqual(await fingerprints(restored), expected, "Induced corruption must be detected");
  await restored.query("rollback");
  assert.deepEqual(await fingerprints(restored), expected);
  report.checks.push({ name: "Verification detects induced corruption and confirms rollback recovery", status: "PASS" });
  console.log(JSON.stringify(report.checks));
} catch (error) {
  report.checks.push({ name: "Controlled restoration", status: "FAIL", error: error.stack ?? String(error) });
  console.error(error); process.exitCode = 1;
} finally {
  await Promise.allSettled([original.end(), restored.end()]);
  await mkdir("test-results/postgres-concurrency", { recursive: true });
  await writeFile("test-results/postgres-concurrency/restoration.json", JSON.stringify(report, null, 2));
}
