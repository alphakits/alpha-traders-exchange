import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildDiscordManagementDiagnostics,
  enqueueDiscordOperatorReconciliation,
  readDiscordManagementDatabaseDiagnostics,
} from "@/lib/discord/management";

const row = {
  connected_identities: 8,
  role_sync: { synced: 4, pending: 2, failed: 1 },
  listing_lifecycle: {
    active: 3,
    sold: 2,
    deleted: 1,
  },
  listing_jobs: {
    pending: 1,
    processing: 1,
    completed: 10,
    dead: 1,
    staleLeases: 0,
    failures: 1,
  },
  cooldown_claims: 2,
  market_content: [{
    key: "live_market_pulse",
    state: "active",
    lastSuccessAt: "2026-08-08T05:00:00.000Z",
    errorCode: null,
    channelId: "5".repeat(18),
  }],
  notifications: {
    pending: 1,
    processing: 0,
    completed: 6,
    dead: 0,
    suppressed: 2,
  },
  interactions: {
    accepted24h: 7,
    rateLimited24h: 1,
    replayed24h: 2,
  },
  operator_requests: {
    pending: 0,
    processing: 1,
    dead: 0,
    staleLeases: 0,
    latest: {
      status: "processing",
      resultCode: null,
      updatedAt: "2026-08-08T05:30:00.000Z",
      requestId: crypto.randomUUID(),
    },
  },
  recent_errors: [{
    source: "listing_jobs",
    code: "delivery_failed",
    occurredAt: "2026-08-08T05:20:00.000Z",
    email: "private@example.com",
  }, {
    source: "operator",
    code: "token=unsafe",
    occurredAt: "2026-08-08T05:21:00.000Z",
  }],
};

describe("Discord management diagnostics", () => {
  it("returns exact safe aggregates and strips private identifiers and unsafe codes", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row], rowCount: 1 });
    const database = await readDiscordManagementDatabaseDiagnostics({
      query,
    } as unknown as Pool);

    expect(database).toMatchObject({
      identities: { connected: 8 },
      approvedSellerRoleSync: { synced: 4, pending: 2, failed: 1 },
      listings: {
        activePosts: 3,
        lifecycle: {
          queued: 0,
          active: 3,
          sold: 2,
        },
      },
      interactions: {
        accepted24h: 7,
        rateLimited24h: 1,
        replayed24h: 2,
      },
      recentErrors: [{
        source: "listing_jobs",
        code: "delivery_failed",
        occurredAt: "2026-08-08T05:20:00.000Z",
      }],
    });
    expect(JSON.stringify(database)).not.toMatch(
      /\d{17,20}|private@example|requestId|channelId|token=unsafe/i,
    );
    expect(query.mock.calls[0]?.[0]).not.toMatch(/select \*/i);
  });

  it("maps signed worker state without exposing guild or bot identities", () => {
    const database = {
      identities: { connected: 0 },
      approvedSellerRoleSync: { synced: 0, pending: 0, failed: 0 },
      listings: {
        lifecycle: {
          queued: 0,
          publishing: 0,
          active: 0,
          update_pending: 0,
          delete_pending: 0,
          sold: 0,
          deleted: 0,
          failed: 0,
        },
        activePosts: 0,
        cooldownClaims: 0,
        jobs: {
          pending: 0,
          processing: 0,
          completed: 0,
          dead: 0,
          staleLeases: 0,
          failures: 0,
        },
      },
      marketContent: [],
      notifications: {
        pending: 0,
        processing: 0,
        completed: 0,
        dead: 0,
        suppressed: 0,
      },
      interactions: {
        accepted24h: 0,
        rateLimited24h: 0,
        replayed24h: 0,
      },
      operatorRequests: {
        pending: 0,
        processing: 0,
        dead: 0,
        staleLeases: 0,
        latest: null,
      },
      recentErrors: [],
    };
    const diagnostics = buildDiscordManagementDiagnostics({
      worker: {
        status: "healthy",
        connected: true,
        readyState: "ready",
        botUsername: "private-bot",
        guildName: "Private Guild",
        guildId: "5".repeat(18),
        apiLatencyMs: 10,
        connectionUptimeMs: 1_000,
        error: null,
        resources: {
          status: "ready",
          totalCount: 13,
          readyCount: 13,
          missingCount: 0,
          errorCode: null,
        },
        commands: {
          status: "ready",
          registeredCount: 7,
          definitionHash: "a".repeat(64),
          lastReconciledAt: "2026-08-08T05:00:00.000Z",
          errorCode: null,
        },
        deployment: {
          source: "railway",
          revision: "de96c1b",
          environment: "production",
        },
      },
      database,
      now: new Date("2026-08-08T06:00:00.000Z"),
    });
    expect(diagnostics.status).toBe("healthy");
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /guildId|guildName|botUsername|private-bot|Private Guild|\d{17,20}/,
    );
  });
});

describe("Discord operator request enqueue", () => {
  it("coalesces an active request and writes a durable audit without Discord calls", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "begin" || sql === "commit") return { rows: [], rowCount: null };
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("where idempotency_key")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("from alpha_exchange.discord_operator_requests")) {
        return {
          rows: [{
            id: crypto.randomUUID(),
            status: "processing",
            created_at: new Date("2026-08-08T05:00:00.000Z"),
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("discord_operator_audit")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;

    const result = await enqueueDiscordOperatorReconciliation({
      actorUserId: "admin-user",
      idempotencyKey: crypto.randomUUID(),
      pool,
    });

    expect(result).toEqual({
      disposition: "coalesced",
      status: "processing",
      acceptedAt: "2026-08-08T05:00:00.000Z",
      resultCode: null,
    });
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("event_type, detail_code"))).toBe(true);
    expect(query.mock.calls.some(([sql]) =>
      /discord\.com|channel_id|message_id|discord_user_id/i.test(String(sql)))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("returns the original terminal result for an idempotency replay", async () => {
    const requestId = crypto.randomUUID();
    const query = vi.fn(async (sql: string) => {
      if (sql === "begin" || sql === "commit") return { rows: [], rowCount: null };
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("where idempotency_key")) {
        return {
          rows: [{
            id: requestId,
            status: "completed",
            result_code: "reconciliation_completed",
            created_at: new Date("2026-08-08T05:00:00.000Z"),
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("discord_operator_audit")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool;

    const result = await enqueueDiscordOperatorReconciliation({
      actorUserId: "admin-user",
      idempotencyKey: crypto.randomUUID(),
      pool,
    });

    expect(result).toEqual({
      disposition: "replayed",
      status: "completed",
      acceptedAt: "2026-08-08T05:00:00.000Z",
      resultCode: "reconciliation_completed",
    });
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("insert into alpha_exchange.discord_operator_requests")))
      .toBe(false);
  });
});
