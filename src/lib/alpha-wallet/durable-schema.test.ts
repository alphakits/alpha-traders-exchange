// @vitest-environment node
// Storage contract tests only. PGlite does not establish native PostgreSQL
// multiprocess/crash safety; repository tests separately verify command replay.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const schema = readFileSync(resolve("docs/alpha-wallet/durable-schema.sql"), "utf8");
const TRON = "tron-sim-usdt";
const BSC = "bsc-sim-binance-peg-usdt";
const GENESIS = "0".repeat(64);
const MAX = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const PAYOUT = "trade-trade-one";
const PAYOUT_ACCOUNT = `payout:${PAYOUT}`;
const DESTINATION = `sim://${TRON}/recipient/buyer-one`;
let db: PGlite;

async function finishHead() {
  await db.exec(`UPDATE alpha_wallet_simulation.head SET
    revision = coalesce((SELECT max(revision) FROM alpha_wallet_simulation.commands), 0),
    last_event_hash = coalesce((SELECT event_hash FROM alpha_wallet_simulation.commands ORDER BY revision DESC LIMIT 1), repeat('0', 64))`);
}

async function transaction(work: () => Promise<void>, options: { gate?: boolean; finish?: boolean } = {}) {
  await db.exec("BEGIN ISOLATION LEVEL SERIALIZABLE; SET LOCAL alpha_wallet.development_schema = 'simulation-only';");
  try {
    if (options.gate !== false) await db.exec("UPDATE alpha_wallet_simulation.head SET lock_version = lock_version + 1");
    await work();
    if (options.finish !== false) await finishHead();
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

async function command(key: string, overrides: { revision?: number; previousHash?: string; inputHash?: string; at?: string } = {}) {
  const last = (await db.query<{ revision: number; event_hash: string }>(
    "SELECT revision, event_hash FROM alpha_wallet_simulation.commands ORDER BY revision DESC LIMIT 1",
  )).rows[0];
  const revision = overrides.revision ?? (last?.revision ?? 0) + 1;
  const hash = revision.toString(16).padStart(64, "0");
  await db.query(`INSERT INTO alpha_wallet_simulation.commands
    (revision, command_key, command_type, occurred_at_ms, command_json, input_hash, result_json,
      result_hash, state_hash, previous_event_hash, event_hash)
    VALUES ($1, $2, 'storage-fixture', $3, $4::jsonb, $5, '{}'::jsonb, $6, $6, $7, $8)`, [
    revision, key, overrides.at ?? "1000", JSON.stringify({ key, revision }), overrides.inputHash ?? "a".repeat(64),
    "b".repeat(64), overrides.previousHash ?? last?.event_hash ?? GENESIS, hash,
  ]);
  return revision;
}

async function journal(revision: number, id: string, asset = TRON) {
  await db.query(`INSERT INTO alpha_wallet_simulation.journals
    (journal_id, command_revision, asset_id, operation) VALUES ($1, $2, $3, $4)`, [id, revision, asset, `operation-${revision}`]);
}

async function entry(journalId: string, account: string, units: string, asset = TRON) {
  await db.query(`INSERT INTO alpha_wallet_simulation.entries
    (journal_id, asset_id, account, delta_units) VALUES ($1, $2, $3, $4)`, [journalId, asset, account, units]);
}

async function transfer(revision: number, id: string, from: string, to: string, units: string, asset = TRON) {
  await journal(revision, id, asset);
  await entry(id, from, `-${units}`, asset);
  await entry(id, to, units, asset);
}

async function balance(account: string, asset = TRON) {
  return (await db.query<{ units: string }>(`SELECT coalesce(sum(delta_units), 0)::text AS units
    FROM alpha_wallet_simulation.entries WHERE account = $1 AND asset_id = $2`, [account, asset])).rows[0]!.units;
}

function eventKey(transactionId: string, index = 0) {
  return JSON.stringify(["tron-simulation", "sim-token-tron-usdt", transactionId, index]);
}

async function claim(revision: number, key: string, direction: string, payload: Record<string, unknown>) {
  await db.query(`INSERT INTO alpha_wallet_simulation.chain_event_claims
    (event_key, direction, command_revision, payload) VALUES ($1, $2, $3, $4::jsonb)`, [key, direction, revision, JSON.stringify(payload)]);
}

const incoming = (units = "500000000") => ({ intentId: "seller-deposit", assetId: TRON,
  destination: `sim://${TRON}/deposit/seller-deposit`, amountRaw: units });
const outgoing = (units = "500000000") => ({ payoutId: PAYOUT, assetId: TRON, destination: DESTINATION, amountRaw: units });

async function payoutEvent(revision: number, state: string, transactionId: string | null = null, count = state === "queued" ? 0 : 1) {
  await db.query(`INSERT INTO alpha_wallet_simulation.payout_events
    (payout_id, command_revision, state, transaction_id, dispatch_count) VALUES ($1, $2, $3, $4, $5)`,
  [PAYOUT, revision, state, transactionId, count]);
}

async function queuePayout(revision: number, units = "500000000") {
  await transfer(revision, `reserve-${revision}`, "trade:trade-one", PAYOUT_ACCOUNT, units);
  await db.query(`INSERT INTO alpha_wallet_simulation.payout_intents
    (payout_id, command_revision, asset_id, seller_id, kind, trade_id, amount_raw, destination, provider_reference)
    VALUES ($1, $2, $3, 'seller-one', 'trade', 'trade-one', $4, $5, $6)`,
  [PAYOUT, revision, TRON, units, DESTINATION, `sim-payout-${PAYOUT}`]);
  await payoutEvent(revision, "queued");
}

async function seedQueuedPayout() {
  await transaction(async () => {
    const revision = await command("seed-deposit-and-reserve");
    await claim(revision, eventKey("sim-tx-deposit"), "incoming", incoming());
    await transfer(revision, "deposit", "external", "available:seller-one", "500000000");
    await transfer(revision, "listing-funding", "available:seller-one", "listing:listing-one", "500000000");
    await transfer(revision, "trade-funding", "listing:listing-one", "trade:trade-one", "500000000");
    await queuePayout(revision);
  });
}

async function startDispatch() {
  await transaction(async () => { await payoutEvent(await command("begin-dispatch"), "submitting"); });
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec("BEGIN ISOLATION LEVEL SERIALIZABLE; SET LOCAL alpha_wallet.development_schema = 'simulation-only';");
  await db.exec(schema);
  await db.exec("COMMIT");
}, 30_000);
afterEach(async () => { await db?.close(); });

describe("connected durable wallet schema", () => {
  it("requires explicit development opt-in before creating any schema", async () => {
    const other = new PGlite();
    try {
      await expect(other.exec(schema)).rejects.toThrow(/simulation-only opt-in/);
      expect((await other.query("SELECT to_regnamespace('alpha_wallet_simulation') AS name")).rows[0]).toEqual({ name: null });
    } finally { await other.close(); }
  });

  it.each(["READ COMMITTED", "REPEATABLE READ"])("refuses write-gate acquisition under %s", async isolation => {
    await db.exec(`BEGIN ISOLATION LEVEL ${isolation}; SET LOCAL alpha_wallet.development_schema = 'simulation-only';`);
    try {
      await expect(db.exec("UPDATE alpha_wallet_simulation.head SET lock_version = lock_version + 1")).rejects.toThrow(/SERIALIZABLE/);
    } finally { await db.exec("ROLLBACK"); }
  });

  it("requires the changed head write gate and accepts lock-only replay transactions", async () => {
    await expect(transaction(async () => { await command("no-lock"); }, { gate: false })).rejects.toThrow(/Increment head.lock_version/);
    await transaction(async () => {}, { finish: false });
    const head = (await db.query<{ revision: number; lock_version: string; last_event_hash: string }>(
      "SELECT revision, lock_version::text, last_event_hash FROM alpha_wallet_simulation.head",
    )).rows[0];
    expect(head).toEqual({ revision: 0, lock_version: "1", last_event_hash: GENESIS });
  });

  it("extends an immutable command chain and rejects key, revision, or hash conflicts", async () => {
    await transaction(async () => { await command("first"); });
    await expect(transaction(async () => { await command("first"); })).rejects.toThrow(/unique constraint/);
    await expect(transaction(async () => { await command("gap", { revision: 3 }); })).rejects.toThrow(/without gaps/);
    await expect(transaction(async () => { await command("bad-link", { previousHash: GENESIS }); })).rejects.toThrow(/without gaps/);
    await expect(transaction(async () => { await command("bad-hash", { inputHash: "not-a-hash" }); })).rejects.toThrow(/check constraint/);
    expect((await db.query("SELECT revision FROM alpha_wallet_simulation.commands")).rows).toEqual([{ revision: 1 }]);
  });

  it("rolls back a command if its head is omitted or points to an invented log tail", async () => {
    await expect(transaction(async () => { await command("orphan"); }, { finish: false })).rejects.toThrow(/head must match/);
    await expect(transaction(async () => {
      await command("wrong-head");
      await db.query("UPDATE alpha_wallet_simulation.head SET revision = 2, last_event_hash = $1", ["f".repeat(64)]);
    }, { finish: false })).rejects.toThrow(/head must match/);
    expect((await db.query("SELECT 1 FROM alpha_wallet_simulation.commands")).rows).toHaveLength(0);
  });

  it("allows several journals for one command and exact 6/18-decimal asset units", async () => {
    await transaction(async () => {
      const revision = await command("multiple-ledger-effects");
      await transfer(revision, "tron-deposit", "external", "available:seller-one", "500000000");
      await transfer(revision, "tron-listing", "available:seller-one", "listing:listing-one", "500000000");
      await transfer(revision, "bsc-deposit", "external", "available:seller-one", "500000000000000000001", BSC);
    });
    expect(await balance("listing:listing-one")).toBe("500000000");
    expect(await balance("available:seller-one", BSC)).toBe("500000000000000000001");
  });

  it.each(["1.5", "NaN", "Infinity", "-Infinity", `${BigInt(MAX) + BigInt(1)}`])("rejects invalid raw units %s", async units => {
    await expect(transaction(async () => {
      const revision = await command("bad-units");
      await journal(revision, "bad-journal");
      await entry("bad-journal", "available:seller-one", units);
    })).rejects.toThrow(/integer_units/);
    expect((await db.query("SELECT 1 FROM alpha_wallet_simulation.commands")).rows).toHaveLength(0);
  });

  it("checks aggregate overdrafts and overflow atomically", async () => {
    await transaction(async () => { await transfer(await command("fund"), "fund", "external", "available:seller-one", "500000000"); });
    await expect(transaction(async () => {
      await transfer(await command("oversell"), "oversell", "available:seller-one", "listing:listing-one", "600000000");
    })).rejects.toThrow(/negative or exceeds/);
    expect(await balance("available:seller-one")).toBe("500000000");
    await expect(transaction(async () => {
      await transfer(await command("overflow"), "overflow", "external", "available:seller-one", MAX);
    })).rejects.toThrow(/negative or exceeds/);
  });

  it("rejects an empty or unbalanced journal and preserves the committed prefix", async () => {
    await transaction(async () => { await command("prefix"); });
    await expect(transaction(async () => { await journal(await command("empty"), "empty"); })).rejects.toThrow(/at least two entries/);
    await expect(transaction(async () => {
      const revision = await command("unbalanced"); await journal(revision, "unbalanced");
      await entry("unbalanced", "external", "-10"); await entry("unbalanced", "available:seller-one", "9");
    })).rejects.toThrow(/sum to zero/);
    expect((await db.query("SELECT revision FROM alpha_wallet_simulation.commands")).rows).toEqual([{ revision: 1 }]);
  });

  it("revalidates late entries after a SET CONSTRAINTS flush", async () => {
    await expect(transaction(async () => {
      await transfer(await command("early-flush"), "flushed", "external", "available:seller-one", "500000000");
      await finishHead(); await db.exec("SET CONSTRAINTS ALL IMMEDIATE");
      await entry("flushed", "commission:seller-one", "1");
    })).rejects.toThrow(/sum to zero/);
  });

  it("prevents cross-asset entries and projections appended to already committed commands", async () => {
    await transaction(async () => { await command("committed"); });
    await expect(transaction(async () => { await journal(1, "late"); })).rejects.toThrow(/same transaction/);
    await expect(transaction(async () => {
      await journal(await command("cross-asset"), "cross-asset");
      await entry("cross-asset", "available:seller-one", "1", BSC);
    })).rejects.toThrow(/foreign key constraint/);
  });

  it("keeps commands, financial records, and payout identity immutable", async () => {
    await seedQueuedPayout();
    for (const sql of [
      "UPDATE alpha_wallet_simulation.commands SET state_hash = repeat('f',64)",
      "DELETE FROM alpha_wallet_simulation.entries",
      "TRUNCATE alpha_wallet_simulation.chain_event_claims",
      "UPDATE alpha_wallet_simulation.payout_intents SET destination = 'sim://tron-sim-usdt/recipient/attacker'",
      "DELETE FROM alpha_wallet_simulation.head",
    ]) await expect(db.exec(sql)).rejects.toThrow(/immutable/);
    expect(await balance(PAYOUT_ACCOUNT)).toBe("500000000");
  });

  it("deduplicates normalized chain identity across incoming and outgoing directions", async () => {
    const key = eventKey("sim-tx-identity");
    await transaction(async () => { await claim(await command("first-claim"), key, "incoming", incoming()); });
    await expect(transaction(async () => { await claim(await command("cross-direction"), key, "outgoing", outgoing()); })).rejects.toThrow(/unique constraint/);
    const whitespaceAlias = '[ "tron-simulation", "sim-token-tron-usdt", "sim-tx-identity", 0 ]';
    await expect(transaction(async () => { await claim(await command("alias"), whitespaceAlias, "incoming", incoming()); })).rejects.toThrow(/unique constraint/);
  });

  it("rejects wrong-asset and wrong-destination deposit claims", async () => {
    await expect(transaction(async () => {
      await claim(await command("wrong-asset"), eventKey("sim-tx-a"), "incoming", { ...incoming(), assetId: BSC });
    })).rejects.toThrow(/claim asset/);
    await expect(transaction(async () => {
      await claim(await command("wrong-route"), eventKey("sim-tx-b"), "incoming", { ...incoming(), destination: "sim://tron-sim-usdt/deposit/other" });
    })).rejects.toThrow(/assigned simulation deposit identity/);
  });

  it("requires an immutable intent and queued event for every payout allocation", async () => {
    await expect(transaction(async () => {
      await transfer(await command("orphan-payout"), "orphan-payout", "external", PAYOUT_ACCOUNT, "500000000");
    })).rejects.toThrow(/matching immutable intent/);
    await seedQueuedPayout();
    expect(await balance(PAYOUT_ACCOUNT)).toBe("500000000");
  });

  it("holds funds across unknown dispatch outcomes and rejects duplicate/reset dispatch claims", async () => {
    await seedQueuedPayout(); await startDispatch();
    await transaction(async () => { await payoutEvent(await command("unknown-result"), "submission_unknown"); });
    expect(await balance(PAYOUT_ACCOUNT)).toBe("500000000");
    await expect(transaction(async () => { await payoutEvent(await command("send-again"), "submitting", null, 2); })).rejects.toThrow();
    await expect(transaction(async () => { await payoutEvent(await command("reset-claim"), "queued", null, 0); })).rejects.toThrow(/cannot be reset/);
  });

  it("cannot skip dispatch or replace a known payout transaction", async () => {
    await seedQueuedPayout();
    await expect(transaction(async () => { await payoutEvent(await command("skip-dispatch"), "broadcast", "sim-tx-skip"); })).rejects.toThrow(/state progression/);
    await startDispatch();
    await transaction(async () => { await payoutEvent(await command("broadcast"), "broadcast", "sim-tx-original"); });
    await expect(transaction(async () => { await payoutEvent(await command("replace"), "confirmed", "sim-tx-replacement"); })).rejects.toThrow(/identity cannot change/);
  });

  it("requires confirmation, full pending balance debit, and matching receipt to commit together", async () => {
    await seedQueuedPayout(); await startDispatch();
    await expect(transaction(async () => { await payoutEvent(await command("confirmation-only"), "confirmed", "sim-tx-payout"); })).rejects.toThrow(/reserved principal/);
    await expect(transaction(async () => {
      const revision = await command("missing-receipt");
      await payoutEvent(revision, "confirmed", "sim-tx-payout");
      await transfer(revision, "settle-without-receipt", PAYOUT_ACCOUNT, "external", "500000000");
    })).rejects.toThrow(/matching consumed outgoing receipt/);
    expect(await balance(PAYOUT_ACCOUNT)).toBe("500000000");
  });

  it("delivers the full 500 USDT and separately settles 10 USDT in fees", async () => {
    await seedQueuedPayout();
    await transaction(async () => { await transfer(await command("fund-commissions"), "commission-deposit", "external", "commission:seller-one", "10000000"); });
    await startDispatch();
    await transaction(async () => {
      const revision = await command("confirm-and-settle-commission");
      await payoutEvent(revision, "confirmed", "sim-tx-payout");
      await transfer(revision, "principal-delivery", PAYOUT_ACCOUNT, "external", "500000000");
      await transfer(revision, "fees", "commission:seller-one", "platform-revenue", "10000000");
      await claim(revision, eventKey("sim-tx-payout"), "outgoing", outgoing());
    });
    expect(await balance(PAYOUT_ACCOUNT)).toBe("0");
    expect(await balance("platform-revenue")).toBe("10000000");
    expect(await balance("external")).toBe("-10000000");
    await transaction(async () => { await payoutEvent(await command("repeat-confirmation"), "confirmed", "sim-tx-payout"); });
    expect(await balance("platform-revenue")).toBe("10000000");
  });

  it("rejects a terminal receipt with mismatching payout amount or destination", async () => {
    await seedQueuedPayout(); await startDispatch();
    await expect(transaction(async () => {
      const revision = await command("wrong-receipt");
      await payoutEvent(revision, "failed_final", "sim-tx-failed");
      await claim(revision, eventKey("sim-tx-failed"), "outgoing", outgoing("490000000"));
    })).rejects.toThrow(/matching consumed outgoing receipt|terminal payout identity/);
    expect(await balance(PAYOUT_ACCOUNT)).toBe("500000000");
  });

  it("retains failed_final funds and prevents silent refunds or terminal state replacement", async () => {
    await seedQueuedPayout(); await startDispatch();
    await transaction(async () => {
      const revision = await command("failed-receipt");
      await payoutEvent(revision, "failed_final", "sim-tx-failed");
      await claim(revision, eventKey("sim-tx-failed"), "outgoing", outgoing());
    });
    await expect(transaction(async () => {
      await transfer(await command("unsafe-refund"), "unsafe-refund", PAYOUT_ACCOUNT, "available:seller-one", "500000000");
    })).rejects.toThrow(/reserved principal/);
    await expect(transaction(async () => { await payoutEvent(await command("replace-failure"), "confirmed", "sim-tx-failed"); })).rejects.toThrow(/state progression/);
    expect(await balance(PAYOUT_ACCOUNT)).toBe("500000000");
  });

  it("allows a pre-payment downward reservation adjustment without the draft lifetime-credit restriction", async () => {
    await transaction(async () => {
      const revision = await command("fund-200");
      await transfer(revision, "fund-200", "external", "trade:trade-one", "200000000");
    });
    await transaction(async () => {
      await transfer(await command("agreed-adjustment"), "return-10", "trade:trade-one", "listing:listing-one", "10000000");
    });
    await transaction(async () => { await queuePayout(await command("release-adjusted-190"), "190000000"); });
    expect(await balance(PAYOUT_ACCOUNT)).toBe("190000000");
    expect(await balance("listing:listing-one")).toBe("10000000");
  });

  it("denies public/client access and has no security-definer or RLS-bypassing view", async () => {
    await db.exec("CREATE ROLE wallet_unprivileged NOLOGIN");
    expect((await db.query(`SELECT has_schema_privilege('wallet_unprivileged','alpha_wallet_simulation','USAGE') AS schema_access,
      has_table_privilege('wallet_unprivileged','alpha_wallet_simulation.commands','SELECT') AS table_access,
      has_function_privilege('wallet_unprivileged','alpha_wallet_simulation.require_writer()','EXECUTE') AS function_access`)).rows[0])
      .toEqual({ schema_access: false, table_access: false, function_access: false });
    expect((await db.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'alpha_wallet_simulation' AND c.relkind = 'r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)`)).rows).toHaveLength(0);
    expect((await db.query(`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'alpha_wallet_simulation' AND p.prosecdef`)).rows).toHaveLength(0);
    expect((await db.query<{ reloptions: string[] }>(`SELECT reloptions FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'alpha_wallet_simulation' AND c.relname = 'account_balances'`)).rows[0]?.reloptions).toContain("security_invoker=true");
  });
});
