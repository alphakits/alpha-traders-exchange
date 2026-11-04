// @vitest-environment node
// These tests only instantiate in-memory PGlite. No database URL is accepted.
// They do not prove real PostgreSQL process concurrency or custody authorization.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const schema = readFileSync(resolve("docs/alpha-wallet/schema-draft.sql"), "utf8");
const TRON = "tron-sim-usdt";
const BSC = "bsc-sim-binance-peg-usdt";
const UINT256_MAX = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
let db: PGlite;

async function transaction(work: () => Promise<void>) {
  await db.exec("BEGIN ISOLATION LEVEL SERIALIZABLE; SET LOCAL alpha_wallet.development_schema = 'simulation-only';");
  try {
    await work();
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

async function account(id: string, kind: string, scope: string, owner = "sim:seller:one", asset = TRON) {
  await db.query(`INSERT INTO alpha_wallet_dev.accounts
    (account_id, asset_id, owner_ref, kind, scope_ref) VALUES ($1, $2, $3, $4, $5)`,
  [id, asset, owner, kind, scope]);
}

async function journal(id: string, kind = "allocation", asset = TRON, key = id) {
  await db.query(`INSERT INTO alpha_wallet_dev.journals
    (journal_id, idempotency_key, asset_id, kind) VALUES ($1, $2, $3, $4)`, [id, key, asset, kind]);
}

async function entries(id: string, lines: Array<[string, string]>, asset = TRON) {
  await db.query(`SELECT account_id FROM alpha_wallet_dev.accounts
    WHERE account_id = ANY($1::text[]) ORDER BY account_id FOR UPDATE`, [lines.map(([id]) => id)]);
  for (const [accountId, units] of lines) {
    await db.query(`INSERT INTO alpha_wallet_dev.entries
      (journal_id, account_id, asset_id, delta_units) VALUES ($1, $2, $3, $4)`, [id, accountId, asset, units]);
  }
}

async function transfer(id: string, source: string, target: string, units: string, kind = "allocation") {
  await journal(id, kind);
  await entries(id, [[source, `-${units}`], [target, units]]);
}

async function deposit(options: {
  id?: string; units?: string; tx?: string; index?: number; asset?: string;
  route?: string; recipient?: string; creditAccount?: string; eventUnits?: string;
  finality?: string; succeeded?: boolean; network?: string; token?: string;
} = {}) {
  const id = options.id ?? "one";
  const asset = options.asset ?? TRON;
  const bsc = asset === BSC;
  const units = options.units ?? "500000000";
  const journalId = `sim:deposit:${id}`;
  const creditAccount = options.creditAccount ?? (bsc ? "sim:bsc:available" : "sim:available");
  await journal(journalId, "deposit", asset);
  await entries(journalId, [[bsc ? "sim:bsc:external" : "sim:external", `-${units}`], [creditAccount, units]], asset);
  await db.query(`INSERT INTO alpha_wallet_dev.deposit_events
    (event_id, asset_id, network, token_contract, transaction_hash, event_index, block_hash, block_height,
      route_id, recipient, credit_account_id, amount_units, finality, execution_succeeded, journal_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 10, $8, $9, $10, $11, $12, $13, $14)`, [
    `sim:event:${id}`, asset,
    options.network ?? (bsc ? "bsc-simulation" : "tron-simulation"),
    options.token ?? (bsc ? "sim-token-bsc-binance-peg-usdt" : "sim-token-tron-usdt"),
    options.tx ?? "a".repeat(64), options.index ?? 0, "b".repeat(64),
    options.route ?? (bsc ? "sim:route:bsc" : "sim:route:principal"),
    options.recipient ?? (bsc ? "sim:address:bsc-principal" : "sim:address:seller-principal"),
    creditAccount, options.eventUnits ?? units, options.finality ?? "simulated_finalized",
    options.succeeded ?? true, journalId,
  ]);
}

async function balance(id: string) {
  return (await db.query<{ units: string }>(
    "SELECT balance_units::text AS units FROM alpha_wallet_dev.account_balances WHERE account_id = $1", [id],
  )).rows[0]?.units;
}

async function reservePayout(options: { id?: string; logicalId?: string; subject?: string; units?: string; reserved?: string } = {}) {
  const id = options.id ?? "one";
  const units = options.units ?? "500000000";
  const journalId = `sim:payout-journal:${id}`;
  const reserved = options.reserved ?? "sim:payout";
  await transfer(journalId, "sim:trade", reserved, units, "payout_reservation");
  await db.query(`INSERT INTO alpha_wallet_dev.payout_intents
    (intent_id, logical_payout_id, purpose, subject_ref, asset_id, source_account_id,
      reserved_account_id, amount_units, destination, reservation_journal_id)
    VALUES ($1, $2, 'trade_release', $3, $4, 'sim:trade', $5, $6, 'sim:address:buyer', $7)`, [
    `sim:intent:${id}`, options.logicalId ?? "sim:release:trade-one", options.subject ?? "sim:trade:one", TRON,
    reserved, units, journalId,
  ]);
}

beforeEach(async () => {
  db = new PGlite();
  await transaction(async () => { await db.exec(schema); });
  await transaction(async () => {
    await account("sim:external", "external_chain", "sim:chain", "sim:platform");
    await account("sim:available", "user_available", "sim:available");
    await account("sim:listing", "listing_reserved", "sim:listing:one");
    await account("sim:trade", "trade_reserved", "sim:trade:one");
    await account("sim:other", "user_available", "sim:available", "sim:seller:two");
    await account("sim:fees", "fee_funds", "sim:fees");
    await account("sim:revenue", "platform_fees", "sim:revenue", "sim:platform");
    await account("sim:payout", "payout_pending", "sim:release:trade-one");
    await account("sim:bsc:external", "external_chain", "sim:chain", "sim:platform", BSC);
    await account("sim:bsc:available", "user_available", "sim:available", "sim:seller:one", BSC);
    await db.exec(`INSERT INTO alpha_wallet_dev.deposit_routes
      (route_id, asset_id, recipient, owner_ref, credit_account_id) VALUES
      ('sim:route:principal', 'tron-sim-usdt', 'sim:address:seller-principal', 'sim:seller:one', 'sim:available'),
      ('sim:route:fees', 'tron-sim-usdt', 'sim:address:seller-fees', 'sim:seller:one', 'sim:fees'),
      ('sim:route:bsc', 'bsc-sim-binance-peg-usdt', 'sim:address:bsc-principal', 'sim:seller:one', 'sim:bsc:available');`);
  });
}, 30_000);

afterEach(async () => { await db?.close(); });

describe("Alpha Wallet development schema: actual storage invariants", () => {
  it("refuses schema creation without explicit simulation-only opt-in", async () => {
    const unconfigured = new PGlite();
    try {
      await expect(unconfigured.exec(schema)).rejects.toThrow(/requires simulation-only opt-in/);
      expect((await unconfigured.query("SELECT 1 FROM pg_namespace WHERE nspname = 'alpha_wallet_dev'")).rows).toHaveLength(0);
    } finally { await unconfigured.close(); }
  });

  it("requires opt-in again for later writes and cannot accept a real asset", async () => {
    await expect(account("sim:new", "user_available", "sim:new")).rejects.toThrow(/writes require simulation-only opt-in/);
    await expect(transaction(async () => {
      await db.exec(`INSERT INTO alpha_wallet_dev.assets VALUES ('usdt-mainnet', 'tron-mainnet', 'real-token', 6)`);
    })).rejects.toThrow(/check constraint/);
  });

  it.each(["READ COMMITTED", "REPEATABLE READ"])("refuses ledger writes under %s isolation", async isolation => {
    await db.exec(`BEGIN ISOLATION LEVEL ${isolation}; SET LOCAL alpha_wallet.development_schema = 'simulation-only';`);
    try {
      await expect(account("sim:wrong-isolation", "user_available", "sim:wrong-isolation")).rejects.toThrow(/require SERIALIZABLE isolation/);
    } finally { await db.exec("ROLLBACK"); }
    expect((await db.query("SELECT 1 FROM alpha_wallet_dev.accounts WHERE account_id = 'sim:wrong-isolation'")).rows).toHaveLength(0);
  });

  it("stores exact 6- and 18-decimal base units without floating point conversion", async () => {
    await transaction(async () => {
      await deposit();
      await deposit({ id: "bsc", asset: BSC, units: "500000000000000000001" });
    });
    expect(await balance("sim:available")).toBe("500000000");
    expect(await balance("sim:bsc:available")).toBe("500000000000000000001");
    expect((await db.query<{ total: string }>("SELECT sum(delta_units)::text AS total FROM alpha_wallet_dev.entries")).rows[0]?.total).toBe("0");
  });

  it.each(["1.5", "NaN", "Infinity", "-Infinity", `${BigInt(UINT256_MAX) + BigInt(1)}`])(
    "rejects noninteger/nonfinite/out-of-range units %s without coercing them", async (units) => {
      await expect(transaction(async () => {
        await journal("sim:bad-quantity");
        await entries("sim:bad-quantity", [["sim:available", units]]);
      })).rejects.toThrow(/integer_units/);
      expect((await db.query("SELECT 1 FROM alpha_wallet_dev.journals")).rows).toHaveLength(0);
    },
  );

  it("deduplicates a deposit by network, token, transaction and log index; a second log remains distinct", async () => {
    await transaction(async () => { await deposit(); });
    await expect(transaction(async () => { await deposit({ id: "duplicate" }); })).rejects.toThrow(/unique constraint/);
    expect(await balance("sim:available")).toBe("500000000");
    await transaction(async () => { await deposit({ id: "second-log", index: 1, units: "1" }); });
    expect(await balance("sim:available")).toBe("500000001");
    expect((await db.query("SELECT 1 FROM alpha_wallet_dev.deposit_events")).rows).toHaveLength(2);
  });

  it("bounds aggregated balances as well as individual journal entries", async () => {
    await transaction(async () => { await deposit({ units: UINT256_MAX }); });
    await expect(transaction(async () => {
      await deposit({ id: "overflow", tx: "c".repeat(64), units: "1" });
    })).rejects.toThrow(/balance exceeds uint256 bounds/);
    expect(await balance("sim:available")).toBe(UINT256_MAX);
  });

  it.each([
    { network: "bsc-simulation" },
    { token: "sim-impostor-usdt" },
    { recipient: "sim:address:unassigned" },
    { creditAccount: "sim:other" },
  ])("refuses wrong network/token/destination/owner routing %j", async (overrides) => {
    await expect(transaction(async () => { await deposit(overrides); })).rejects.toThrow(/foreign key constraint/);
    expect(await balance("sim:available")).toBe("0");
    expect(await balance("sim:other")).toBe("0");
  });

  it.each([{ finality: "pending" }, { succeeded: false }])("refuses unfinalized or failed receipts %j", async (overrides) => {
    await expect(transaction(async () => { await deposit(overrides); })).rejects.toThrow(/check constraint/);
    expect(await balance("sim:available")).toBe("0");
  });

  it("requires credit to equal the exact event amount; principal has no commission tolerance", async () => {
    await expect(transaction(async () => { await deposit({ eventUnits: "499000000" }); })).rejects.toThrow(/match exactly one finalized routed event/);
    expect(await balance("sim:available")).toBe("0");
  });

  it("rejects unbalanced and empty journals at commit and rolls back their complete transaction", async () => {
    await expect(transaction(async () => {
      await deposit();
      await journal("sim:unbalanced");
      await entries("sim:unbalanced", [["sim:available", "-10"], ["sim:listing", "9"]]);
    })).rejects.toThrow(/sum to zero/);
    expect((await db.query("SELECT 1 FROM alpha_wallet_dev.entries")).rows).toHaveLength(0);
    await expect(transaction(async () => { await journal("sim:empty"); })).rejects.toThrow(/at least two entries/);
  });

  it("revalidates entries added after an early SET CONSTRAINTS flush", async () => {
    await expect(transaction(async () => {
      await deposit();
      await transfer("sim:initial-allocation", "sim:available", "sim:listing", "100000000");
      await db.exec("SET CONSTRAINTS ALL IMMEDIATE");
      await entries("sim:initial-allocation", [["sim:trade", "1"]]);
    })).rejects.toThrow(/sum to zero/);
    expect((await db.query("SELECT 1 FROM alpha_wallet_dev.entries")).rows).toHaveLength(0);
  });

  it("prevents reserving more than a seller has and preserves the earlier committed reservation", async () => {
    await transaction(async () => {
      await deposit();
      await transfer("sim:reserve-400", "sim:available", "sim:listing", "400000000");
    });
    await expect(transaction(async () => {
      await transfer("sim:reserve-another-200", "sim:available", "sim:listing", "200000000");
    })).rejects.toThrow(/cannot be negative/);
    expect(await balance("sim:available")).toBe("100000000");
    expect(await balance("sim:listing")).toBe("400000000");
  });

  it("rejects cross-asset posting and cross-owner allocation", async () => {
    await transaction(async () => { await deposit(); });
    await expect(transaction(async () => {
      await journal("sim:wrong-asset");
      await entries("sim:wrong-asset", [["sim:available", "-1"], ["sim:bsc:available", "1"]]);
    })).rejects.toThrow(/foreign key constraint/);
    await expect(transaction(async () => {
      await transfer("sim:wrong-owner", "sim:available", "sim:other", "1");
    })).rejects.toThrow(/one owner/);
  });

  it("does not allow fabricating a balance through an unlinked external-chain transfer", async () => {
    await expect(transaction(async () => {
      await transfer("sim:unverified-credit", "sim:external", "sim:available", "500000000");
    })).rejects.toThrow(/principal buckets/);
    await expect(transaction(async () => {
      await transfer("sim:missing-deposit", "sim:external", "sim:available", "500000000", "deposit");
    })).rejects.toThrow(/finalized routed event/);
  });

  it("prevents changing journal history or appending new entries to a committed journal", async () => {
    await transaction(async () => { await deposit(); });
    for (const statement of [
      "UPDATE alpha_wallet_dev.entries SET delta_units = delta_units + 1",
      "DELETE FROM alpha_wallet_dev.deposit_events",
      "TRUNCATE alpha_wallet_dev.entries",
      "UPDATE alpha_wallet_dev.accounts SET owner_ref = 'sim:attacker'",
    ]) await expect(db.exec(statement)).rejects.toThrow(/immutable/);
    await expect(transaction(async () => {
      await entries("sim:deposit:one", [["sim:listing", "1"]]);
    })).rejects.toThrow(/same transaction/);
    expect(await balance("sim:available")).toBe("500000000");
  });

  it("reserves the full principal with one immutable payout intent in the same transaction", async () => {
    await transaction(async () => {
      await deposit();
      await transfer("sim:lock-listing", "sim:available", "sim:listing", "500000000");
      await transfer("sim:lock-trade", "sim:listing", "sim:trade", "500000000");
      await reservePayout();
    });
    expect(await balance("sim:trade")).toBe("0");
    expect(await balance("sim:payout")).toBe("500000000");
    expect(await balance("sim:revenue")).toBe("0");
    expect((await db.query("SELECT 1 FROM alpha_wallet_dev.payout_intents")).rows).toHaveLength(1);
    await expect(db.exec("UPDATE alpha_wallet_dev.payout_intents SET destination = 'sim:address:attacker'")).rejects.toThrow(/immutable/);
  });

  it("rejects a payout reservation without its matching outbox instruction", async () => {
    await transaction(async () => {
      await deposit();
      await transfer("sim:fund-trade", "sim:available", "sim:trade", "500000000");
    });
    await expect(transaction(async () => {
      await transfer("sim:orphan-payout", "sim:trade", "sim:payout", "500000000", "payout_reservation");
    })).rejects.toThrow(/commit together/);
    expect(await balance("sim:trade")).toBe("500000000");
    expect(await balance("sim:payout")).toBe("0");
  });

  it("rejects a second logical payout even with another transport intent ID", async () => {
    await transaction(async () => {
      await deposit();
      await transfer("sim:fund-trade", "sim:available", "sim:trade", "500000000");
      await reservePayout();
    });
    // Try the outbox insert first to exercise its durable deduplication separately
    // from the closed trade-account guard, which also rejects a new reservation.
    await expect(transaction(async () => {
      await journal("sim:payout-journal:retry", "payout_reservation");
      await db.exec(`INSERT INTO alpha_wallet_dev.payout_intents
        (intent_id, logical_payout_id, purpose, subject_ref, asset_id, source_account_id,
          reserved_account_id, amount_units, destination, reservation_journal_id)
        SELECT 'sim:intent:retry', logical_payout_id, purpose, subject_ref, asset_id, source_account_id,
          reserved_account_id, amount_units, destination, 'sim:payout-journal:retry'
        FROM alpha_wallet_dev.payout_intents WHERE intent_id = 'sim:intent:one'`);
    })).rejects.toThrow(/unique constraint/);
    expect(await balance("sim:payout")).toBe("500000000");
    expect(await balance("sim:trade")).toBe("0");
  });

  it("rejects a reduced payout for a fully allocated trade", async () => {
    await transaction(async () => {
      await deposit();
      await transfer("sim:fund-trade", "sim:available", "sim:trade", "500000000");
    });
    await expect(transaction(async () => { await reservePayout({ units: "490000000" }); })).rejects.toThrow(/full allocated trade principal/);
    expect(await balance("sim:trade")).toBe("500000000");
    expect(await balance("sim:payout")).toBe("0");
  });

  it("cannot hide a reduced payout by returning some trade principal in the same transaction", async () => {
    await transaction(async () => {
      await deposit();
      await transfer("sim:fund-trade", "sim:available", "sim:trade", "500000000");
    });
    await expect(transaction(async () => {
      await transfer("sim:divert-principal", "sim:trade", "sim:available", "10000000");
      await reservePayout({ units: "490000000" });
    })).rejects.toThrow(/full allocated trade principal/);
    expect(await balance("sim:trade")).toBe("500000000");
    expect(await balance("sim:available")).toBe("0");
  });

  it("prevents reopening a trade allocation after its payout instruction was committed", async () => {
    await transaction(async () => {
      await deposit();
      await transfer("sim:fund-trade", "sim:available", "sim:trade", "500000000");
      await reservePayout();
      await deposit({ id: "more", tx: "c".repeat(64), units: "1" });
    });
    await expect(transaction(async () => {
      await transfer("sim:refill-closed-trade", "sim:available", "sim:trade", "1");
    })).rejects.toThrow(/closed by its payout reservation/);
    expect(await balance("sim:trade")).toBe("0");
    expect(await balance("sim:available")).toBe("1");
  });

  it("keeps separate fee settlement from all 500 USDT of buyer principal", async () => {
    await transaction(async () => {
      await deposit();
      await deposit({ id: "fees", tx: "c".repeat(64), units: "10000000", route: "sim:route:fees",
        recipient: "sim:address:seller-fees", creditAccount: "sim:fees" });
      await transfer("sim:fee-payment", "sim:fees", "sim:revenue", "10000000", "fee_collection");
    });
    expect(await balance("sim:available")).toBe("500000000");
    expect(await balance("sim:revenue")).toBe("10000000");
    await expect(transaction(async () => {
      await transfer("sim:deduct-principal", "sim:available", "sim:revenue", "1000000", "fee_collection");
    })).rejects.toThrow(/never trade principal/);
    expect(await balance("sim:available")).toBe("500000000");
  });

  it("denies unprivileged schema/function/table access and keeps RLS default-deny even after a SELECT grant", async () => {
    await db.exec("CREATE ROLE wallet_client NOLOGIN");
    const permissions = (await db.query<{ schema_usage: boolean; table_select: boolean; function_execute: boolean }>(`
      SELECT has_schema_privilege('wallet_client', 'alpha_wallet_dev', 'USAGE') AS schema_usage,
        has_table_privilege('wallet_client', 'alpha_wallet_dev.accounts', 'SELECT') AS table_select,
        has_function_privilege('wallet_client', 'alpha_wallet_dev.require_simulation()', 'EXECUTE') AS function_execute`)).rows[0];
    expect(permissions).toEqual({ schema_usage: false, table_select: false, function_execute: false });
    expect((await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'alpha_wallet_dev' AND c.relkind = 'r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)`)).rows).toHaveLength(0);
    expect((await db.query(`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'alpha_wallet_dev' AND p.prosecdef`)).rows).toHaveLength(0);
    await db.exec("BEGIN; GRANT USAGE ON SCHEMA alpha_wallet_dev TO wallet_client; GRANT SELECT ON alpha_wallet_dev.accounts TO wallet_client; SET LOCAL ROLE wallet_client;");
    try { expect((await db.query("SELECT * FROM alpha_wallet_dev.accounts")).rows).toHaveLength(0); }
    finally { await db.exec("ROLLBACK"); }
  });

  it("revokes pre-existing default client grants on the draft tables and functions", async () => {
    const inheritedGrants = new PGlite();
    try {
      await inheritedGrants.exec(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
        ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
        BEGIN; SET LOCAL alpha_wallet.development_schema = 'simulation-only';`);
      await inheritedGrants.exec(schema);
      await inheritedGrants.exec("COMMIT");
      for (const role of ["anon", "authenticated", "service_role"]) {
        const permissions = (await inheritedGrants.query<{ table_select: boolean; function_execute: boolean }>(`
          SELECT has_table_privilege($1, 'alpha_wallet_dev.accounts', 'SELECT') AS table_select,
            has_function_privilege($1, 'alpha_wallet_dev.require_simulation()', 'EXECUTE') AS function_execute`, [role])).rows[0];
        expect(permissions).toEqual({ table_select: false, function_execute: false });
      }
    } finally { await inheritedGrants.close(); }
  });
});
