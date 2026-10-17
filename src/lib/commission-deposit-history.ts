import "server-only";
import type { Pool } from "pg";
import { getRuntimePostgresPool } from "./postgres-runtime";
import type { CommissionDeposit, DepositScan, DepositScanProgress } from "./commission-deposit-discovery";

type Network = "TRC20" | "BEP20";
type Provider = "TRC20" | "BEP20" | "BINANCE_DEPOSITS";
type Scanner = (since: number, progress?: DepositScanProgress) => Promise<DepositScan>;
type ProviderState = { configured: boolean; complete: boolean; pages?: number; deposits?: number; progress?: DepositScanProgress; error?: string };
interface HistoryState {
  schema: 1;
  since: number;
  scanSince: number;
  until: number;
  consumed: boolean;
  deposits: CommissionDeposit[];
  providers: Partial<Record<Provider, ProviderState>>;
}
export interface HistoryStore {
  load(scope: string): Promise<{ version: number; state: HistoryState } | null>;
  save(scope: string, version: number | null, state: HistoryState): Promise<boolean>;
}
export function getCommissionHistoryStore() {
  const pool = getRuntimePostgresPool();
  if (!pool) throw new Error("Durable commission receiving history is required");
  return postgresCommissionHistoryStore(pool);
}
export function postgresCommissionHistoryStore(pool: Pick<Pool, "query">): HistoryStore {
  return {
    async load(scope) {
      const result = await pool.query<{ version: string; payload: HistoryState }>(
        "SELECT version, payload FROM alpha_exchange.commission_deposit_scan_progress WHERE scope=$1", [scope]);
      const row = result.rows[0];
      return row ? { version: Number(row.version), state: row.payload } : null;
    },
    async save(scope, version, state) {
      const result = version === null
        ? await pool.query(`INSERT INTO alpha_exchange.commission_deposit_scan_progress(scope,version,payload)
            VALUES($1,1,$2::jsonb) ON CONFLICT (scope) DO NOTHING RETURNING version`, [scope, JSON.stringify(state)])
        : await pool.query(`UPDATE alpha_exchange.commission_deposit_scan_progress
            SET version=version+1,payload=$3::jsonb,updated_at=now() WHERE scope=$1 AND version=$2 RETURNING version`,
          [scope, version, JSON.stringify(state)]);
      return result.rows.length === 1;
    },
  };
}

function mergeDeposits(previous: CommissionDeposit[], incoming: CommissionDeposit[]) {
  // Keep conflicting amounts/networks visible to attribution; only identical
  // observations are deduplicated. Never turn conflicting proofs into one.
  const found = new Map<string, CommissionDeposit>();
  for (const deposit of [...previous, ...incoming]) {
    const key = `${deposit.network}:${deposit.signature.toLowerCase()}:${deposit.amountMicros}`;
    const old = found.get(key);
    found.set(key, old ? { ...old, timestamp: Math.min(old.timestamp, deposit.timestamp), payer: old.payer || deposit.payer } : deposit);
  }
  return [...found.values()];
}

/** Bounded requests, durable continuation and a fresh common time horizon.
 * Partial history never becomes payment proof. A completed historical sweep
 * catches up through the current invocation before old receipts are released.
 * The next completed cycle starts a full sweep again, including late indexing.
 */
export async function discoverCommissionHistory(input: {
  scope: "checkout" | "legacy";
  since: number;
  networks: Network[];
  store: HistoryStore;
  scanners: Record<Provider, Scanner>;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(input.since) || input.since < 0 || input.since > now) throw new Error("Invalid commission history bounds");
  const saved = await input.store.load(input.scope);
  if (saved && (saved.state.schema !== 1 || !Number.isSafeInteger(saved.version) || saved.version < 1
    || !Number.isSafeInteger(saved.state.since) || !Number.isSafeInteger(saved.state.scanSince)
    || !Number.isSafeInteger(saved.state.until) || !Array.isArray(saved.state.deposits) || !saved.state.providers
    || saved.state.since < 0 || saved.state.scanSince < saved.state.since || typeof saved.state.consumed !== "boolean"
    || (saved.state.until !== 0 && (saved.state.until < saved.state.scanSince || saved.state.until > now)))) {
    throw new Error("Commission history checkpoint is invalid");
  }
  const state: HistoryState = !saved || saved.state.consumed || input.since < saved.state.since
    ? { schema: 1, since: input.since, scanSince: input.since, until: now, consumed: false, deposits: [], providers: {} }
    : structuredClone(saved.state);
  if (state.until === 0) state.until = now; // Begin the catch-up window now, not when the prior run ended.
  const providers = ["TRC20", "BEP20", "BINANCE_DEPOSITS"] as const;
  const scans = await Promise.allSettled(providers.map(async (provider) => {
    const current = state.providers[provider];
    if (current?.complete) return null;
    return input.scanners[provider](state.scanSince, current?.progress ?? { until: state.until });
  }));
  let pages = 0;
  for (let index = 0; index < providers.length; index++) {
    const provider = providers[index];
    const scan = scans[index];
    if (scan.status === "rejected") {
      const reason = scan.reason instanceof Error && /^(?:tron|bep20|binance)_[a-z0-9_]+$/.test(scan.reason.message)
        ? scan.reason.message : "provider_unavailable";
      state.providers[provider] = { ...state.providers[provider], configured: true, complete: false, error: reason };
    } else if (scan.value) {
      const value = scan.value;
      pages += value.pages;
      if (value.configured && !value.complete && (!value.continuation || value.continuation.until !== state.until)) {
        // Older scanner implementations remain fail-closed; no fabricated cursor.
        state.providers[provider] = { configured: true, complete: false, pages: value.pages, deposits: value.deposits.length, error: "provider_continuation_unavailable" };
      } else {
        state.providers[provider] = { configured: value.configured, complete: value.complete, pages: value.pages, deposits: value.deposits.length, progress: value.continuation };
      }
      state.deposits = mergeDeposits(state.deposits, value.deposits.filter(deposit => deposit.timestamp <= state.until));
    }
  }
  const binance = state.providers.BINANCE_DEPOSITS;
  const binanceComplete = binance?.configured === true && binance.complete;
  const binanceCovered = binanceComplete || binance?.configured === false;
  const coverage: Record<Network, boolean> = {
    TRC20: state.providers.TRC20?.complete === true && binanceCovered,
    BEP20: (state.providers.BEP20?.complete === true || binanceComplete) && binanceCovered,
  };
  const health = structuredClone(state.providers);
  const fresh = state.until >= now;
  const completeNetworks = input.networks.filter(network => coverage[network] && fresh);
  const allCovered = input.networks.every(network => coverage[network]);
  const deposits = state.deposits.filter(deposit => deposit.timestamp >= input.since);
  if (allCovered && !fresh) {
    // Include the boundary second again. Receipt deduplication prevents replay.
    state.scanSince = Math.max(state.since, state.until - 1000);
    state.until = 0;
    state.providers = {};
  } else if (allCovered && fresh) state.consumed = true;
  // Losing concurrent requests cannot publish uncommitted progress or receipts.
  const committed = await input.store.save(input.scope, saved?.version ?? null, state);
  const allowed = committed ? completeNetworks : [];
  return { deposits: deposits.filter(deposit => allowed.includes(deposit.network as Network)),
    scanned: deposits.length, pages, providers: health, complete: input.networks.every(network => allowed.includes(network)),
    incompleteNetworks: input.networks.filter(network => !allowed.includes(network)), checkpointConflict: !committed };
}
