import "server-only";

import type { Pool } from "pg";
import {
  readProductionHealthObservation,
  type ProductionHealthHistoryStore,
  type ProductionHealthObservation,
} from "./production-health-worker";

// Reuse the worker's existing database. No extra hosted service or credentials.
// Append-only observations keep an older rolling deployment from overwriting a
// newer worker's evidence. Only the allowlisted public summary is persisted.
export class PostgresProductionHealthHistory implements ProductionHealthHistoryStore {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async load(): Promise<ProductionHealthObservation[]> {
    const result = await this.pool.query<{ observation: unknown }>(`
      SELECT observation FROM alpha_exchange.public_production_health_history
      ORDER BY started_at DESC LIMIT 24
    `);
    return result.rows.reverse().map(row => readProductionHealthObservation(row.observation));
  }

  async save(value: ProductionHealthObservation): Promise<void> {
    const observation = readProductionHealthObservation(value);
    await this.pool.query(`
      INSERT INTO alpha_exchange.public_production_health_history (started_at, observation)
      VALUES ($1::timestamptz, $2::jsonb) ON CONFLICT (started_at) DO NOTHING
    `, [observation.startedUtc, JSON.stringify(observation)]);
    await this.pool.query(`
      DELETE FROM alpha_exchange.public_production_health_history
      WHERE started_at < $1::timestamptz - INTERVAL '1 day'
    `, [observation.startedUtc]);
  }
}
