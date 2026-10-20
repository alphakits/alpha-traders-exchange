import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const tables = ["notifications", "audit_logs", "activity_logs", "evidence", "sms_deliveries"];
const migration = readFileSync("supabase/migrations/20261020083126_trade_lifecycle_read_indexes.sql", "utf8");

describe("trade lifecycle history indexes", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create schema alpha_exchange");
    for (const table of tables) {
      await db.exec(`create table alpha_exchange.${table} (
        id text primary key, sort_index integer not null, purchase_request_id text, payload jsonb not null
      );
      alter table alpha_exchange.${table} enable row level security;
      insert into alpha_exchange.${table}
      select i::text, i - 1501, case when i = 1700 then 'target' else 'unrelated-' || i end,
        jsonb_build_object('id', i::text, 'relatedRequestId', case when i = 1700 then 'target' else 'unrelated-' || i end)
      from generate_series(1,3000) i;
      analyze alpha_exchange.${table}`);
    }
    await db.exec(`begin; ${migration} commit;`);
  });
  afterAll(async () => { await db.close(); });

  it("finds both global ordering bounds without scanning unrelated event rows", async () => {
    for (const table of tables) {
      const sql = `select min(sort_index) as minimum, max(sort_index) as maximum from alpha_exchange.${table}`;
      expect((await db.query(sql)).rows).toEqual([{ minimum: -1500, maximum: 1499 }]);
      const plan = JSON.stringify((await db.query(`explain (format json) ${sql}`)).rows);
      expect(plan).toContain("Index Only Scan");
      expect(plan).not.toContain("Seq Scan");
    }
  });

  it("uses indexed trade filters while preserving the selected payload and ordering", async () => {
    for (const [table, filter] of [["notifications", "payload->>'relatedRequestId'"], ["audit_logs", "purchase_request_id"]]) {
      const sql = `select payload from alpha_exchange.${table} where ${filter} = $1 order by sort_index`;
      expect((await db.query(sql, ["target"])).rows).toEqual([
        { payload: { id: "1700", relatedRequestId: "target" } },
      ]);
      const plan = JSON.stringify((await db.query(`explain (format json) ${sql}`, ["target"])).rows);
      expect(plan).toContain(`idx_alpha_exchange_${table}_request_sort`);
      expect(plan).not.toContain("Seq Scan");
    }
  });

  it("replays without changing retained rows or row-security settings", async () => {
    await db.exec(`begin; ${migration} commit;`);
    for (const table of tables) {
      expect((await db.query(`select count(*)::int as count, sum(sort_index)::int as sum from alpha_exchange.${table}`)).rows)
        .toEqual([{ count: 3000, sum: -1500 }]);
      expect((await db.query("select relrowsecurity as rls from pg_class where oid = $1::regclass", [`alpha_exchange.${table}`])).rows)
        .toEqual([{ rls: true }]);
    }
  });
});
