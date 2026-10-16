// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdir, readFile } from "node:fs/promises";

// A clean schema must be reproducible from tracked migrations. Supabase's
// managed roles/storage objects are prerequisites, not application bootstrap.
// This exercises PostgreSQL semantics locally; it does not prove that the
// deployed Supabase migration history or backups can restore the database.
describe("platform migration reconstruction", () => {
  it("reconstructs every tracked migration in chronological order without runtime bootstrap", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    try {
      await db.exec("create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
      const files = (await Promise.all(["supabase/migrations", "db/migrations"].map(async directory =>
        (await readdir(directory)).filter(name => name.endsWith(".sql")).map(name => ({ name, path: `${directory}/${name}` })),
      ))).flat().sort((a, b) => a.name.localeCompare(b.name));
      expect(files.length).toBeGreaterThanOrEqual(35);
      for (const file of files) {
        try { await db.exec(await readFile(file.path, "utf8")); }
        catch (error) { throw new Error(`Migration reconstruction failed at ${file.path}`, { cause: error }); }
      }
      const tables = await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='alpha_exchange'");
      expect(tables.rows.map(row => row.table_name)).toEqual(expect.arrayContaining([
        "users", "purchase_requests", "commissions", "journal_trades", "journal_file_cleanup",
      ]));
      const policies = await db.query("select tablename from pg_policies where schemaname='alpha_exchange' and tablename like 'journal_%'");
      expect(policies.rows).toHaveLength(5);
    } finally { await db.close(); }
  }, 30_000);
});
