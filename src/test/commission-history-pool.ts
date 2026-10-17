/** Isolated SQL boundary for runtime tests. The real statements are exercised
 * separately against embedded PostgreSQL, including compare-and-swap races. */
export function commissionHistoryTestPool() {
  const rows = new Map<string, { version: number; payload: unknown }>();
  return { async query(sql: string, values: unknown[] = []) {
    const scope = String(values[0]);
    if (sql.startsWith("SELECT version, payload")) return { rows: rows.has(scope) ? [structuredClone(rows.get(scope)!)] : [] };
    if (sql.startsWith("INSERT INTO alpha_exchange.commission_deposit_scan_progress")) {
      if (rows.has(scope)) return { rows: [] };
      rows.set(scope, { version: 1, payload: JSON.parse(String(values[1])) });
      return { rows: [{ version: 1 }] };
    }
    if (sql.startsWith("UPDATE alpha_exchange.commission_deposit_scan_progress")) {
      const current = rows.get(scope);
      if (!current || current.version !== values[1]) return { rows: [] };
      rows.set(scope, { version: current.version + 1, payload: JSON.parse(String(values[2])) });
      return { rows: [{ version: current.version + 1 }] };
    }
    return { rows: [{ ready: true }] };
  } };
}
