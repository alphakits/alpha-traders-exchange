// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdir, readFile } from "node:fs/promises";

// Supabase's migration replayer submits top-level statements separately. Sending
// a complete file through exec() can create an implicit PostgreSQL transaction
// and conceal a LOCK TABLE that lacks an explicit BEGIN.
function statements(sql: string) {
  const tokens = sql.match(/--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$|'(?:[^']|'')*'|"(?:[^"]|"")*"|;|[^$'";/-]+|[\s\S]/g) ?? [];
  const result: string[] = [];
  let current = "";
  let dollarQuote: string | null = null;
  for (const token of tokens) {
    current += token;
    if (/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$$/.test(token)) {
      if (dollarQuote === token) dollarQuote = null;
      else if (dollarQuote === null) dollarQuote = token;
    }
    if (token === ";" && dollarQuote === null) {
      result.push(current);
      current = "";
    }
  }
  if (current.replace(/--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//g, "").trim()) result.push(current);
  return result;
}

// A clean schema must be reproducible from tracked migrations. Supabase's
// managed roles/storage objects are prerequisites, not application bootstrap.
// This exercises PostgreSQL semantics locally; it does not prove that the
// deployed Supabase migration history or backups can restore the database.
describe("platform migration reconstruction", () => {
  it("reconstructs every tracked migration in chronological order without runtime bootstrap", async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    try {
      await db.exec("create role anon; create role authenticated; create role service_role; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);");
      const files = (await Promise.all(["supabase/migrations"].map(async directory =>
        (await readdir(directory)).filter(name => name.endsWith(".sql")).map(name => ({ name, path: `${directory}/${name}` })),
      ))).flat().sort((a, b) => a.name.localeCompare(b.name));
      expect(files.length).toBeGreaterThanOrEqual(35);
      expect(new Set(files.map(file => file.name.split("_")[0])).size).toBe(files.length);
      for (const file of files) {
        try {
          for (const statement of statements(await readFile(file.path, "utf8"))) {
            await db.exec(statement);
          }
        }
        catch (error) { throw new Error(`Migration reconstruction failed at ${file.path}`, { cause: error }); }
      }
      const tables = await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='alpha_exchange'");
      expect(tables.rows.map(row => row.table_name)).toEqual(expect.arrayContaining([
        "users", "purchase_requests", "commissions", "journal_trades", "journal_file_cleanup",
      ]));
      // Opt-in provider tables must not be silently added by the default chain.
      expect(tables.rows.some(row => row.table_name.startsWith("whatsapp_"))).toBe(false);
      const policies = await db.query("select tablename from pg_policies where schemaname='alpha_exchange' and tablename like 'journal_%'");
      expect(policies.rows).toHaveLength(5);
      // These protections were observed on production but were missing from
      // the ordered migration chain. A restore must preserve the same boundary.
      const protectedTables = ["admin_cms.lesson_versions","admin_cms.lessons","admin_cms.media_items","alpha_exchange.activity_logs","alpha_exchange.audit_logs","alpha_exchange.beta_announcements","alpha_exchange.beta_feedback","alpha_exchange.commissions","alpha_exchange.disputes","alpha_exchange.evidence","alpha_exchange.listings","alpha_exchange.notifications","alpha_exchange.password_reset_tokens","alpha_exchange.private_beta_invite_uses","alpha_exchange.private_beta_invites","alpha_exchange.purchase_requests","alpha_exchange.runtime_meta","alpha_exchange.seller_applications","alpha_exchange.seller_profiles","alpha_exchange.seller_reports","alpha_exchange.seller_settings","alpha_exchange.sessions","alpha_exchange.trades","alpha_exchange.trust_score_history","alpha_exchange.trust_snapshots","alpha_exchange.users"];
      const security = await db.query<{ name: string; enabled: boolean }>("select n.nspname||'.'||c.relname as name,c.relrowsecurity as enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname||'.'||c.relname=any($1::text[])", [protectedTables]);
      expect(security.rows).toHaveLength(protectedTables.length);
      expect(security.rows.filter(row => !row.enabled)).toEqual([]);
      await db.exec("insert into alpha_exchange.users(id,email,role,seller_status,availability_status,online_status,created_at,updated_at,sort_index,payload) values('privacy-audit','privacy@example.test','buyer','buyer','available','offline',now(),now(),0,'{}'); grant usage on schema alpha_exchange to authenticated; grant select, update on alpha_exchange.users to authenticated; set role authenticated;");
      expect((await db.query("select id from alpha_exchange.users")).rows).toEqual([]);
      expect((await db.query("update alpha_exchange.users set role='owner' returning id")).rows).toEqual([]);
      await db.exec("reset role");
      expect((await db.query<{ role: string }>("select role from alpha_exchange.users where id='privacy-audit'")).rows).toEqual([{ role: "buyer" }]);
    } finally { await db.close(); }
  }, 30_000);
});
