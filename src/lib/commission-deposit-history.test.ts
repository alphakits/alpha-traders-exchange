// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverCommissionHistory, postgresCommissionHistoryStore } from "./commission-deposit-history";
import { scanTronCommissionDeposits, type CommissionDeposit, type DepositScanProgress } from "./commission-deposit-discovery";
import { CANONICAL_TRC20_COMMISSION_WALLET, OFFICIAL_TRON_USDT_CONTRACT } from "./commission-config";

const migration = readFileSync(resolve("supabase/migrations/20261017212857_commission_deposit_scan_progress.sql"), "utf8");
let db: PGlite;
const unavailable = async () => ({ configured: false, complete: false, pages: 0, deposits: [] });
const empty = async () => ({ configured: true, complete: true, pages: 1, deposits: [] });
const receipt = (extra = {}): CommissionDeposit => ({ network: "TRC20", signature: "a".repeat(64), payer: "synthetic", amountMicros: 100_000_000, timestamp: 100_000, ...extra });
const store = () => postgresCommissionHistoryStore(db as unknown as Pick<Pool, "query">);
beforeEach(async () => { db = new PGlite(); await db.exec("CREATE SCHEMA alpha_exchange"); await db.exec(migration); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.close(); });

describe("durable receiving history", () => {
  it("resumes past five TRON pages after restart, catches up, and retains a competing later receipt", async () => {
    const requested: Array<{ fingerprint: string | null; until: string | null; since: number }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("fingerprint") ?? 0);
      const since = Number(url.searchParams.get("min_timestamp"));
      requested.push({ fingerprint: url.searchParams.get("fingerprint"), until: url.searchParams.get("max_timestamp"), since });
      const data = since > 100_000 || page === 6 ? [] : [{ transaction_id: page === 5 ? "b".repeat(64) : "a".repeat(64), from: "synthetic",
        to: CANONICAL_TRC20_COMMISSION_WALLET, type: "Transfer", value: page === 5 ? "102000000" : "100000000",
        block_timestamp: 100_000, token_info: { address: OFFICIAL_TRON_USDT_CONTRACT, decimals: 6 } }];
      return new Response(JSON.stringify({ success: true, data, ...(since <= 100_000 && page < 6 ? { meta: { fingerprint: String(page + 1) } } : {}) }));
    }));
    const run = (now: number) => discoverCommissionHistory({ scope: "checkout", since: 50_000, now, networks: ["TRC20"], store: store(),
      scanners: { TRC20: scanTronCommissionDeposits, BEP20: unavailable, BINANCE_DEPOSITS: unavailable } });
    expect(await run(1_000_000)).toMatchObject({ complete: false, deposits: [], pages: 5 });
    expect(await run(1_001_000)).toMatchObject({ complete: false, deposits: [], pages: 2 });
    expect(requested[5]).toMatchObject({ fingerprint: "5", until: "1000000" });
    const final = await run(1_002_000);
    expect(final.complete).toBe(true);
    expect(final.deposits.map(d => d.amountMicros).sort()).toEqual([100_000_000, 102_000_000]);
    expect(requested[7]).toEqual({ fingerprint: null, until: "1002000", since: 999_000 });
    // Completion starts a full new observation cycle, including late indexing.
    expect(await run(1_003_000)).toMatchObject({ complete: false, deposits: [], pages: 5 });
    expect(requested[8].since).toBe(50_000);
  });
  it("retains the last committed cursor on an outage and does not publish stale historical coverage", async () => {
    const scanner = vi.fn().mockResolvedValueOnce({ configured: true, complete: false, pages: 5, deposits: [receipt()], continuation: { until: 200_000, fingerprint: "six" } })
      .mockRejectedValueOnce(new Error("tron_http_503"))
      .mockResolvedValueOnce({ configured: true, complete: true, pages: 1, deposits: [] }).mockImplementation(empty);
    const run = (now: number) => discoverCommissionHistory({ scope: "checkout", since: 1, now, networks: ["TRC20"], store: store(),
      scanners: { TRC20: scanner, BEP20: unavailable, BINANCE_DEPOSITS: unavailable } });
    await run(200_000);
    expect(await run(201_000)).toMatchObject({ complete: false, deposits: [], providers: { TRC20: { error: "tron_http_503" } } });
    expect(await run(202_000)).toMatchObject({ complete: false, deposits: [] });
    expect(scanner.mock.calls[2][1]).toEqual({ until: 200_000, fingerprint: "six" });
    expect(await run(203_000)).toMatchObject({ complete: true, deposits: [receipt()] });
  });
  it("publishes progress once when two workers read the same version", async () => {
    let started = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const scanner = async () => { if (++started === 2) release(); await barrier; return { configured: true, complete: true, pages: 1, deposits: [receipt()] }; };
    const run = () => discoverCommissionHistory({ scope: "checkout", since: 1, now: 200_000, networks: ["TRC20"], store: store(),
      scanners: { TRC20: scanner, BEP20: unavailable, BINANCE_DEPOSITS: unavailable } });
    const results = await Promise.all([run(), run()]);
    expect(results.filter(r => r.complete)).toHaveLength(1);
    expect(results.filter(r => r.checkpointConflict)).toHaveLength(1);
    expect(results.reduce((n, r) => n + r.deposits.length, 0)).toBe(1);
  });
  it("blocks configured incomplete Binance history even when both chains are complete", async () => {
    const result = await discoverCommissionHistory({ scope: "legacy", since: 1, now: 200_000, networks: ["TRC20", "BEP20"], store: store(),
      scanners: { TRC20: async () => ({ configured: true, complete: true, pages: 1, deposits: [receipt()] }), BEP20: empty,
        BINANCE_DEPOSITS: async () => ({ configured: true, complete: false, pages: 5, deposits: [], continuation: { until: 200_000, offset: 1000 } }) } });
    expect(result).toMatchObject({ complete: false, incompleteNetworks: ["TRC20", "BEP20"], deposits: [] });
  });
  it("restarts at an earlier lower bound and rechecks newly configured providers", async () => {
    const scanner = vi.fn(async (_since: number, progress?: DepositScanProgress) => ({ configured: true, complete: false, pages: 5,
      deposits: [], continuation: { until: progress!.until, fingerprint: "next" } }));
    const binance = vi.fn().mockImplementationOnce(unavailable).mockImplementation(empty);
    const run = (since: number, now: number) => discoverCommissionHistory({ scope: "checkout", since, now, networks: ["TRC20"], store: store(),
      scanners: { TRC20: scanner, BEP20: unavailable, BINANCE_DEPOSITS: binance } });
    await run(100, 200_000); await run(1, 201_000);
    expect(scanner.mock.calls[1]).toEqual([1, { until: 201_000 }]);
    expect(binance).toHaveBeenCalledTimes(2);
  });
  it("keeps conflicting observations and does not release receipts after failed persistence", async () => {
    const scanner = async () => ({ configured: true, complete: true, pages: 1, deposits: [receipt(), receipt(), receipt({ amountMicros: 101_000_000 })] });
    const base = { scope: "checkout" as const, since: 1, now: 200_000, networks: ["TRC20" as const], scanners: { TRC20: scanner, BEP20: unavailable, BINANCE_DEPOSITS: unavailable } };
    expect((await discoverCommissionHistory({ ...base, store: store() })).deposits).toHaveLength(2);
    await expect(discoverCommissionHistory({ ...base, store: { load: async () => null, save: async () => { throw new Error("storage unavailable"); } } })).rejects.toThrow("storage unavailable");
  });
  it("keeps private progress outside the public API and applies the migration idempotently", async () => {
    await db.exec(migration);
    const rls = await db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE oid='alpha_exchange.commission_deposit_scan_progress'::regclass");
    expect(rls.rows[0].relrowsecurity).toBe(true);
    await db.exec("CREATE ROLE history_reader; GRANT USAGE ON SCHEMA alpha_exchange TO history_reader; SET ROLE history_reader");
    await expect(db.query("SELECT * FROM alpha_exchange.commission_deposit_scan_progress")).rejects.toThrow(/permission denied/);
  });
});
