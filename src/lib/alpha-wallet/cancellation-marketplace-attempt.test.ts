// @vitest-environment node
// Real physical transactions in one disposable database; the adversarial test
// adapter deliberately replaces its owner to verify that no child adopts it.
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCancellationMarketplaceFixture } from "../../../scripts/alpha-wallet/cancellation-marketplace-fixtures";
import { createDevelopmentCancellationMarketplaceWalletCoordinator } from "./cancellation-marketplace-coordinator";
import type { WalletSql, WalletStore } from "./durable-store";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));
const MODE = "simulation-only" as const, TIMEOUT = 120_000;
const FLAGS = ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"];
type Seam = "before auth" | "before registrar";
let db: PGlite, store: WalletStore, transactionOpen = false;
let fixture: Awaited<ReturnType<typeof buildCancellationMarketplaceFixture>>;
let armed: Seam | undefined, completeCanonicalRead = false;
let replacement: { originalId: string; replacementId: string; seam: Seam } | undefined;
let replacementStatements: string[] = [];

async function identity() {
  return (await db.query<{ transaction_id: string }>("SELECT txid_current()::text AS transaction_id")).rows[0].transaction_id;
}
async function begin() {
  await db.exec("BEGIN ISOLATION LEVEL SERIALIZABLE; SET LOCAL alpha_wallet.development_schema='simulation-only'; SET LOCAL TimeZone='UTC';");
}
function matchesSeam(sql: string, seam: Seam) {
  if (!completeCanonicalRead || sql.includes("cancellation coordinator: original attempt owner")) return false;
  // These are the actual separate certificate probes at the two handoffs. The
  // generic stored readers use a space before `true`, unlike the registrar.
  return seam === "before auth" ? sql.includes("AS isolation,current_setting('transaction_read_only')")
    : sql.includes("AS isolation, current_setting('transaction_read_only')")
      && sql.includes("current_setting('alpha_wallet.development_schema',true)");
}
async function replaceAtSeam(sql: string) {
  if (armed && !replacement && matchesSeam(sql, armed)) {
    const originalId = await identity(), seam = armed;
    // Actual transaction boundaries deliberately live only in this adversarial
    // test adapter. The production WalletStore API never authorizes them.
    await db.exec("ROLLBACK"); await begin();
    const replacementId = await identity();
    await db.query("INSERT INTO cancellation_attempt_replacement_probe VALUES ('replacement-owner-work')");
    if (seam === "before registrar") {
      // A legitimate semantic refusal after a fresh child certificate would
      // poison B in the old handoff: B does not have the original cohort scope.
      await db.exec("CREATE SCHEMA alpha_wallet_marketplace_simulation");
    }
    replacement = { originalId, replacementId, seam };
  }
  if (replacement) replacementStatements.push(sql);
}

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "test"); for (const flag of FLAGS) vi.stubEnv(flag, undefined);
  db = await PGlite.create({ parsers: { 20: value => value, 1700: value => value } });
  const tx: WalletSql = {
    async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      await replaceAtSeam(sql);
      const result = await db.query<Row>(sql, values);
      if (sql.includes("prepayment cancellation: lossless event JSON")) completeCanonicalRead = true;
      return { rows: result.rows };
    },
    async exec(sql: string) { await replaceAtSeam(sql); await db.exec(sql); },
  };
  store = {
    async transaction<T>(work: (owner: WalletSql) => Promise<T>) {
      if (transactionOpen) throw new Error("This regression adapter forbids nested transactions");
      await begin(); transactionOpen = true;
      try {
        const value = await work(tx);
        if (!replacement) await db.exec("COMMIT");
        return value;
      } catch (error) {
        // Once replaced, B belongs to another owner. Leave it open so the test
        // can prove the rejected attempt did not abort or commit B's work.
        if (!replacement) await db.exec("ROLLBACK");
        throw error;
      } finally { if (!replacement) transactionOpen = false; }
    },
    close: async () => undefined,
  };
  fixture = await buildCancellationMarketplaceFixture(store);
  await store.transaction(owner => owner.exec("CREATE TABLE cancellation_attempt_replacement_probe (id text PRIMARY KEY)"));
}, TIMEOUT);
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test"); for (const flag of FLAGS) vi.stubEnv(flag, undefined);
  armed = undefined; replacement = undefined; completeCanonicalRead = false; replacementStatements = [];
});
afterEach(async () => {
  try { if (transactionOpen) await db.exec("ROLLBACK"); }
  finally {
    transactionOpen = false; armed = undefined; replacement = undefined; vi.unstubAllEnvs();
  }
});
afterAll(async () => {
  try { if (transactionOpen) await db.exec("ROLLBACK"); } finally { await db?.close(); }
}, TIMEOUT);

describe("earliest cancellation coordinator physical ownership", () => {
  it.each(["before auth", "before registrar"] as const)("never lets a child adopt or poison a real replacement %s", async seam => {
    armed = seam;
    const coordinator = createDevelopmentCancellationMarketplaceWalletCoordinator({ mode: MODE, store, clock: fixture.clock });
    const input = { ...fixture.sellerInput, operationId: "replacement-owner-regression",
      ...(seam === "before auth" ? { sessionToken: "synthetic-nonexistent-session-credential" } : {}) };
    // The stored-auth boundary may sanitize the owner's refusal. The concrete
    // contract here is rejection before authority or cleanup reaches B.
    await expect(coordinator.cancelRequest(input)).rejects.toThrow();
    expect(replacement?.seam).toBe(seam);
    expect(replacement?.originalId).toMatch(/^[1-9][0-9]*$/);
    expect(replacement?.replacementId).toMatch(/^[1-9][0-9]*$/);
    expect(replacement?.replacementId).not.toBe(replacement?.originalId);
    expect(replacementStatements.some(sql => /SELECT\s+1\s*\/\s*0/i.test(sql))).toBe(false);
    if (seam === "before auth") {
      expect(replacementStatements.some(sql => sql.includes("FOR SHARE OF session, account"))).toBe(false);
    } else {
      expect(replacementStatements.some(sql => sql.includes("recovered_predecessor")
        || /INSERT INTO alpha_wallet_cancellation_marketplace_simulation\.transaction_contexts/i.test(sql))).toBe(false);
    }
    // A poisoned PostgreSQL transaction rejects these real reads and writes.
    expect((await db.query("SELECT id FROM cancellation_attempt_replacement_probe ORDER BY id")).rows)
      .toEqual([{ id: "replacement-owner-work" }]);
    await db.query("INSERT INTO cancellation_attempt_replacement_probe VALUES ('replacement-still-writable')");
    expect((await db.query("SELECT count(*)::text AS count FROM cancellation_attempt_replacement_probe")).rows)
      .toEqual([{ count: "2" }]);
    expect(await identity()).toBe(replacement?.replacementId);
  }, TIMEOUT);
});
