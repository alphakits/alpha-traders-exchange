// @vitest-environment node
// Raw PostgreSQL-in-WASM transactions intentionally omit WalletStore's failure
// tracking. A participant must abort its own certified transaction independently
// of the outer store's extra guard, even when its caller catches the rejection.
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletSql, WalletStore } from "./durable-store";
import { registerInitialMarketplaceContext } from "./initial-marketplace-coordination-store";
import { inspectRestoredMarketplaceWallet } from "./marketplace-backup";
import {
  bindMarketplaceCommand, insertMarketplaceAcceptance, insertMarketplaceEnrollment,
  readMarketplaceEnrollment, registerMarketplaceContext, type MarketplaceContext,
} from "./marketplace-coordination-store";
import { readMarketplaceRecoveryReceipt } from "./marketplace-recovery-store";
import { v2Command } from "./v2-commands";

vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => { throw new Error("Ambient database discovery is forbidden"); } }));

const MODE = "simulation-only" as const;
const OWNER = "cleanup-fixture-owner", REQUEST = "cleanup-fixture-request";
const TIMEOUT = 120_000;
let db: PGlite;
let statements: string[];

function localRuntime() {
  vi.stubEnv("NODE_ENV", "test");
  for (const key of ["VERCEL", "VERCEL_ENV", "AWS_LAMBDA_FUNCTION_NAME", "CF_PAGES", "K_SERVICE", "ALPHA_WALLET_MAINNET_ENABLED", "ALPHA_WALLET_SIGNING_ENABLED"]) {
    vi.stubEnv(key, undefined);
  }
}
const flipRuntime = () => vi.stubEnv("VERCEL_ENV", "production");
const inside = (tx: WalletSql): WalletStore => ({ transaction: work => work(tx), close: async () => undefined });
const raw = (): WalletSql => ({
  exec: async sql => { statements.push(sql); await db.exec(sql); },
  query: (sql, params) => { statements.push(sql); return db.query(sql, params); },
});
const register = (tx: WalletSql, operation: "inspect" | "enroll" | "accept" | "pause" = "inspect") => registerMarketplaceContext({
  mode: MODE, tx, requestId: REQUEST, actorUserId: OWNER, operation,
});
async function begin() {
  await db.exec("BEGIN ISOLATION LEVEL SERIALIZABLE; SET LOCAL alpha_wallet.development_schema='simulation-only'");
}
async function markers() {
  return (await db.query<{ marker: string }>("SELECT marker FROM cleanup_probe ORDER BY marker")).rows.map(row => row.marker);
}

beforeEach(async () => {
  localRuntime(); statements = [];
  db = new PGlite();
  // Minimal storage tables isolate the participant transaction contract. The
  // production/development SQL writer guards are tested in their own suites;
  // no trigger or WalletStore may mask these cleanup failures here.
  await db.exec(`CREATE TABLE cleanup_probe (marker text PRIMARY KEY);
    CREATE SCHEMA alpha_wallet_marketplace_simulation;
    CREATE TABLE alpha_wallet_marketplace_simulation.transaction_contexts (
      transaction_id text PRIMARY KEY, request_id text NOT NULL, operation text NOT NULL,
      actor_user_id text NOT NULL, planned_command jsonb, planned_command_key text
    );
    CREATE TABLE alpha_wallet_marketplace_simulation.enrollments (request_id text PRIMARY KEY);
    CREATE SCHEMA alpha_wallet_initial_marketplace_simulation;
    CREATE TABLE alpha_wallet_initial_marketplace_simulation.transaction_contexts (
      transaction_id text PRIMARY KEY, request_id text NOT NULL, operation text NOT NULL,
      actor_user_id text NOT NULL, planned_command jsonb, planned_command_key text
    );`);
}, TIMEOUT);

afterEach(async () => {
  localRuntime();
  try { if (db) { await db.exec("ROLLBACK"); await db.close(); } }
  finally { vi.unstubAllEnvs(); }
}, TIMEOUT);

async function refusedWorkRollsBack(work: (tx: WalletSql) => Promise<unknown>) {
  await begin();
  await db.query("INSERT INTO cleanup_probe VALUES ('before-refusal')");
  let captured: unknown;
  try { await work(raw()); }
  catch (error) { captured = error; }
  finally { localRuntime(); }
  expect(captured).toBeDefined();
  // This checks the actual SQL transaction state, not an exception remembered
  // by a mock/store wrapper or a caller's own decision to roll back.
  await expect(db.query("SELECT 1")).rejects.toMatchObject({ code: "25P02" });
  await db.exec("COMMIT"); // PostgreSQL turns an aborted COMMIT into ROLLBACK.
  expect(await markers()).toEqual([]);
  return captured;
}

describe("recovery participants clean up their actual certified transaction", () => {
  it("aborts recovery storage after a successful awaited read discovers a runtime change", async () => {
    let flipped = false;
    const error = await refusedWorkRollsBack(tx => readMarketplaceRecoveryReceipt({
      exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await tx.query<Row>(sql, params);
        if (sql.includes("to_regclass('alpha_wallet_marketplace_simulation.recovery_receipts')")) {
          flipped = true; flipRuntime();
        }
        return result;
      },
    }));
    expect(flipped).toBe(true); expect(String(error)).toMatch(/hosted runtime/i);
    expect(statements.some(sql => sql.includes("abort failed marketplace recovery storage"))).toBe(true);
  });

  it("aborts the API-owned transaction when a nested reader fails before it can certify itself", async () => {
    let probes = 0, flipped = false;
    const error = await refusedWorkRollsBack(tx => inspectRestoredMarketplaceWallet({
      mode: MODE, expectedChecksum: "a".repeat(64), store: inside({ exec: sql => tx.exec(sql),
        async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
          const result = await tx.query<Row>(sql, params);
          if (sql.includes("transaction_isolation") && ++probes === 3) {
            // The outer API has passed both identity probes. The nested receipt
            // reader has not yet certified its own original transaction.
            flipped = true; flipRuntime();
          }
          return result;
        },
      }),
    }));
    expect(flipped).toBe(true);
    expect(error).toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(statements.some(sql => sql.includes("abort failed combined marketplace recovery"))).toBe(true);
    expect(statements.some(sql => sql.includes("abort failed marketplace recovery storage"))).toBe(false);
  });

  it("aborts a newly written context registration after its awaited INSERT changes the runtime", async () => {
    let inserted = false;
    const error = await refusedWorkRollsBack(tx => register({ exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await tx.query<Row>(sql, params);
        if (/^INSERT INTO alpha_wallet_marketplace_simulation\.transaction_contexts/.test(sql)) {
          inserted = true; flipRuntime();
        }
        return result;
      },
    }));
    expect(inserted).toBe(true); expect(String(error)).toMatch(/hosted runtime/i);
    expect((await db.query("SELECT * FROM alpha_wallet_marketplace_simulation.transaction_contexts")).rows).toEqual([]);
    expect(statements.some(sql => sql.includes("abort failed marketplace coordination participant"))).toBe(true);
  });

  it.each([
    ["correction", registerMarketplaceContext, "alpha_wallet_marketplace_simulation"],
    ["initial", registerInitialMarketplaceContext, "alpha_wallet_initial_marketplace_simulation"],
  ] as const)("keeps %s registration cleanup on its captured handle after caller mutation", async (_kind, registerContext, schema) => {
    let inserted = false, replacementCalls = 0;
    const error = await refusedWorkRollsBack(async tx => {
      const replacement: WalletSql = {
        exec: async () => { replacementCalls++; throw new Error("Replacement transaction must remain untouched"); },
        query: async () => { replacementCalls++; throw new Error("Replacement transaction must remain untouched"); },
      };
      const options = {
        mode: MODE, tx, requestId: REQUEST, operation: "inspect" as const, actorUserId: OWNER,
      };
      options.tx = { exec: sql => tx.exec(sql),
        async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
          const result = await tx.query<Row>(sql, params);
          if (sql.startsWith(`INSERT INTO ${schema}.transaction_contexts`)) {
            inserted = true;
            options.tx = replacement;
            options.requestId = "mutated-request";
            options.actorUserId = "mutated-actor";
            flipRuntime();
          }
          return result;
        },
      };
      return registerContext(options);
    });
    expect(inserted).toBe(true); expect(String(error)).toMatch(/hosted runtime/i);
    expect(replacementCalls).toBe(0);
    expect((await db.query(`SELECT * FROM ${schema}.transaction_contexts`)).rows).toEqual([]);
    expect(statements.some(sql => sql.includes("abort failed") && sql.includes("coordination participant"))).toBe(true);
  });

  it.each(["before-call", "after-await"] as const)("aborts earlier writes when an existing context sees a runtime refusal %s", async when => {
    let armed = false, flipped = false;
    const error = await refusedWorkRollsBack(async tx => {
      const intercepted: WalletSql = { exec: sql => tx.exec(sql),
        async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
          const result = await tx.query<Row>(sql, params);
          if (armed && when === "after-await" && sql.startsWith("SELECT * FROM alpha_wallet_marketplace_simulation.enrollments")) {
            flipped = true; flipRuntime();
          }
          return result;
        },
      };
      const context = await register(intercepted);
      armed = true;
      if (when === "before-call") { flipped = true; flipRuntime(); }
      return readMarketplaceEnrollment(context);
    });
    expect(flipped).toBe(true); expect(String(error)).toMatch(/hosted runtime/i);
    expect(statements.some(sql => sql.includes("abort failed marketplace coordination participant"))).toBe(true);
  });

  it.each(["enrollment", "acceptance"] as const)("aborts an uncloneable %s input inside its certified context", async kind => {
    const error = await refusedWorkRollsBack(async tx => {
      const context = await register(tx, kind === "enrollment" ? "enroll" : "accept");
      const input = { inputDigest: () => "uncloneable", execution: {} };
      return kind === "enrollment"
        ? insertMarketplaceEnrollment(context, input as unknown as Parameters<typeof insertMarketplaceEnrollment>[1])
        : insertMarketplaceAcceptance(context, input as unknown as Parameters<typeof insertMarketplaceAcceptance>[1]);
    });
    expect(error).toMatchObject({ name: "DataCloneError" });
    expect(statements.some(sql => sql.includes("abort failed marketplace coordination participant"))).toBe(true);
  });

  it("aborts malformed bound-command capture without leaving the context's earlier work committable", async () => {
    await refusedWorkRollsBack(async tx => {
      const context = await register(tx, "pause");
      const command = v2Command("pause", { kind: "operator", id: OWNER }, "cleanup-original-pause", null);
      return bindMarketplaceCommand(context, { ...command, requestId: () => "uncloneable" } as unknown as typeof command);
    });
    expect(statements.some(sql => sql.includes("abort failed marketplace coordination participant"))).toBe(true);
  });

  it("copies a bound command before awaiting transaction validation so caller mutation cannot change its identity", async () => {
    await begin();
    const tx = raw();
    let armed = false, release!: () => void, reached!: () => void;
    const wait = new Promise<void>(resolveWait => { release = resolveWait; });
    const barrier = new Promise<void>(resolveBarrier => { reached = resolveBarrier; });
    const intercepted: WalletSql = { exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await tx.query<Row>(sql, params);
        if (armed && sql.includes("transaction_isolation")) { armed = false; reached(); await wait; }
        return result;
      },
    };
    const context = await register(intercepted, "pause");
    const command = v2Command("pause", { kind: "operator", id: OWNER }, "cleanup-original-pause", null);
    const original = structuredClone(command);
    armed = true;
    const pending = bindMarketplaceCommand(context, command);
    try {
      await barrier;
      command.requestId = "cleanup-mutated-pause";
      release(); await pending;
      const retained = (await db.query<{ planned_command: unknown }>(
        "SELECT planned_command FROM alpha_wallet_marketplace_simulation.transaction_contexts")).rows[0];
      expect(retained.planned_command).toEqual(original);
      await db.exec("COMMIT");
    } finally { release(); await pending.catch(() => undefined); }
  });

  it("never aborts a replacement physical transaction through a retained context", async () => {
    await begin(); const tx = raw();
    const context: MarketplaceContext = await register(tx);
    await db.exec("COMMIT");
    await begin();
    await db.query("INSERT INTO cleanup_probe VALUES ('replacement-transaction')");
    flipRuntime();
    try { await expect(readMarketplaceEnrollment(context)).rejects.toThrow(/hosted runtime/i); }
    finally { localRuntime(); }
    await expect(db.query("SELECT 1")).resolves.toMatchObject({ rows: [{ "?column?": 1 }] });
    expect(statements.some(sql => sql.includes("1 / 0"))).toBe(false);
    await db.exec("COMMIT");
    expect(await markers()).toEqual(["replacement-transaction"]);
  });

  it.each(["storage", "API"] as const)("never poisons a replaced physical transaction during %s failure cleanup", async scope => {
    await begin();
    await db.query("INSERT INTO cleanup_probe VALUES ('original-explicitly-committed')");
    const tx = raw(); let probes = 0, replaced = false;
    const intercepted: WalletSql = { exec: sql => tx.exec(sql),
      async query<Row extends Record<string, unknown>>(sql: string, params?: unknown[]) {
        const result = await tx.query<Row>(sql, params);
        if (sql.includes("transaction_isolation") && ++probes === 3) {
          await db.exec("COMMIT"); await begin();
          await db.query("INSERT INTO cleanup_probe VALUES ('replacement-transaction')");
          replaced = true; flipRuntime();
        }
        return result;
      },
    };
    try {
      if (scope === "storage") await expect(readMarketplaceRecoveryReceipt(intercepted)).rejects.toThrow(/hosted runtime/i);
      else await expect(inspectRestoredMarketplaceWallet({ mode: MODE, store: inside(intercepted), expectedChecksum: "a".repeat(64) }))
        .rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    } finally { localRuntime(); }
    expect(replaced).toBe(true);
    await expect(db.query("SELECT 1")).resolves.toMatchObject({ rows: [{ "?column?": 1 }] });
    expect(statements.some(sql => sql.includes("1 / 0"))).toBe(false);
    await db.exec("COMMIT");
    expect(await markers()).toEqual(["original-explicitly-committed", "replacement-transaction"]);
  });
});
