// @vitest-environment node

import type { Pool, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildDiscordApprovedSellerMessage,
  buildDiscordWelcomeMessage,
  DiscordCommunityNotificationWorker,
  DiscordDirectMessageError,
  DiscordRestDirectMessagePublisher,
  enqueueDiscordWelcome,
  notificationNonce,
} from "@/lib/discord/community-notifications";
import type {
  DiscordGatewayClient,
  DiscordGuildMemberJoin,
} from "@/lib/discord/gateway-client";

function result<T extends QueryResultRow>(
  rows: T[],
  rowCount = rows.length,
): QueryResult<T> {
  return { command: "", rowCount, oid: 0, fields: [], rows };
}

const event: DiscordGuildMemberJoin = {
  guildId: "1".repeat(18),
  discordUserId: "2".repeat(18),
  joinedAt: "2026-08-08T05:00:00.000Z",
  isBot: false,
};

describe("Discord community notifications", () => {
  it("builds branded safe welcome and approval DMs without internal identifiers", () => {
    const welcome = buildDiscordWelcomeMessage("https://www.alphatraders.co.il");
    const approval = buildDiscordApprovedSellerMessage({
      siteUrl: "https://www.alphatraders.co.il",
      sellerLoungeChannelId: null,
    });
    const serialized = JSON.stringify([welcome, approval]);
    expect(serialized).toContain("Welcome to Alpha Traders");
    expect(serialized).toContain("Approved Seller access unlocked");
    expect(serialized).toContain("https://www.alphatraders.co.il");
    expect(serialized).not.toMatch(/email|wallet|interaction.token|platform_user_id/i);
  });

  it("deduplicates reconnect copies by durable join generation and ignores bots", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(result([], 1))
      .mockResolvedValueOnce(result([], 0));
    const database = { query } as unknown as Pool;

    await expect(enqueueDiscordWelcome(database, event)).resolves.toBe(true);
    await expect(enqueueDiscordWelcome(database, event)).resolves.toBe(false);
    await expect(enqueueDiscordWelcome(database, {
      ...event,
      isBot: true,
    })).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]?.[1]).toContain(event.joinedAt);
  });

  it("sends a stable enforced Discord nonce for retry idempotency", async () => {
    const posts: Array<{ route: string; body: Record<string, unknown> }> = [];
    const rest = {
      post: vi.fn(async (route: string, input: { body: Record<string, unknown> }) => {
        posts.push({ route, body: input.body });
        return posts.length % 2 === 1
          ? { id: "3".repeat(18) }
          : { id: "4".repeat(18) };
      }),
    };
    const publisher = new DiscordRestDirectMessagePublisher(
      "test-token",
      rest as never,
    );
    const nonce = notificationNonce(
      "approved-status:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    await publisher.send({
      discordUserId: event.discordUserId,
      nonce,
      body: buildDiscordWelcomeMessage("https://www.alphatraders.co.il"),
    });

    expect(nonce).toHaveLength(25);
    expect(posts[1]?.body).toMatchObject({
      nonce,
      enforce_nonce: true,
    });
  });

  it("records DM-disabled as terminal suppression instead of retrying forever", async () => {
    let claimCount = 0;
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        if (sql.includes("update alpha_exchange.discord_notification_deliveries delivery")) {
          claimCount += 1;
          return claimCount === 1
            ? result([{
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                notification_type: "welcome",
                discord_user_id: event.discordUserId,
                lease_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                attempts: 1,
                source_key: `welcome:${event.guildId}:${event.discordUserId}:${event.joinedAt}`,
              }])
            : result([]);
        }
        if (sql.includes("count(*) filter")) {
          return result([{
            pending_count: 0,
            dead_count: 0,
            suppressed_count: 1,
            last_delivered_at: null,
            error_code: null,
          }]);
        }
        return result([]);
      }),
    } as unknown as Pool;
    const gateway = {
      subscribeGuildMemberJoin: vi.fn(() => vi.fn()),
    } as unknown as DiscordGatewayClient;
    const worker = new DiscordCommunityNotificationWorker({
      pool,
      gateway,
      publisher: {
        send: vi.fn(async () => {
          throw new DiscordDirectMessageError("dm_disabled");
        }),
      },
      siteUrl: "https://www.alphatraders.co.il",
      guildId: event.guildId,
      pollIntervalMs: 60_000,
    });

    await worker.start();
    await worker.shutdown();

    const failure = queries.find(({ sql }) => sql.includes("with failed as"));
    expect(failure?.values?.slice(2)).toEqual([
      "suppressed",
      15,
      "dm_disabled",
      "suppressed",
    ]);
    expect(worker.getDiagnostics()).toMatchObject({
      status: "ready",
      suppressedCount: 1,
    });
  });

  it("retries a post-send stale completion with one stable Discord nonce", async () => {
    let claimCount = 0;
    let completionCount = 0;
    const sourceKey =
      "approved-status:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("update alpha_exchange.discord_notification_deliveries delivery")) {
          claimCount += 1;
          return claimCount <= 2
            ? result([{
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                notification_type: "approved_seller",
                discord_user_id: event.discordUserId,
                lease_token: claimCount === 1
                  ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
                  : "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                attempts: claimCount,
                source_key: sourceKey,
              }])
            : result([]);
        }
        if (sql.includes("with completed as")) {
          completionCount += 1;
          return result([], completionCount === 1 ? 0 : 1);
        }
        if (sql.includes("count(*) filter")) {
          return result([{
            pending_count: 0,
            dead_count: 0,
            suppressed_count: 0,
            last_delivered_at: new Date("2026-08-08T05:00:00.000Z"),
            error_code: null,
          }]);
        }
        if (sql.includes("seller_lounge")) {
          return result([{ discord_resource_id: null }]);
        }
        return result([], 1);
      }),
    } as unknown as Pool;
    const deliveredNonces = new Set<string>();
    let physicalDeliveries = 0;
    const send = vi.fn(async ({ nonce }: { nonce: string }) => {
      if (!deliveredNonces.has(nonce)) {
        physicalDeliveries += 1;
      }
      deliveredNonces.add(nonce);
    });
    const worker = new DiscordCommunityNotificationWorker({
      pool,
      gateway: {
        subscribeGuildMemberJoin: vi.fn(() => vi.fn()),
      } as unknown as DiscordGatewayClient,
      publisher: { send },
      siteUrl: "https://www.alphatraders.co.il",
      guildId: event.guildId,
      pollIntervalMs: 60_000,
    });

    await worker.start();
    await worker.shutdown();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0].nonce).toBe(
      send.mock.calls[1]?.[0].nonce,
    );
    expect(deliveredNonces.size).toBe(1);
    expect(physicalDeliveries).toBe(1);
    expect(completionCount).toBe(2);
    expect(pool.query.mock.calls.some(([sql]) =>
      String(sql).includes("lease_token = $2::uuid")
      && String(sql).includes("status = 'processing'"))).toBe(true);
  });

  it("runs retention at startup and on a bounded advisory-lock cadence", async () => {
    vi.useFakeTimers();
    const maintenanceSql: string[] = [];
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("cleanup_discord_community_state")) {
          maintenanceSql.push(sql);
          return result([]);
        }
        if (sql.includes("update alpha_exchange.discord_notification_deliveries delivery")) {
          return result([]);
        }
        if (sql.includes("count(*) filter")) {
          return result([{
            pending_count: 0,
            dead_count: 0,
            suppressed_count: 0,
            last_delivered_at: null,
            error_code: null,
          }]);
        }
        return result([]);
      }),
    } as unknown as Pool;
    const worker = new DiscordCommunityNotificationWorker({
      pool,
      gateway: {
        subscribeGuildMemberJoin: vi.fn(() => vi.fn()),
      } as unknown as DiscordGatewayClient,
      publisher: { send: vi.fn() },
      siteUrl: "https://www.alphatraders.co.il",
      guildId: event.guildId,
      pollIntervalMs: 60_000,
      maintenanceIntervalMs: 1_000,
    });

    await worker.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await worker.shutdown();

    expect(maintenanceSql).toHaveLength(2);
    expect(maintenanceSql[0]).toContain("pg_try_advisory_xact_lock");
    expect(maintenanceSql[0]).toContain(
      "cleanup_discord_community_state",
    );
  });

  it("quarantines retries that outlive Discord nonce enforcement", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        queries.push({ sql: statement, values });
        if (statement.includes("with indeterminate as")) return result([]);
        if (statement.includes("count(*) filter")) {
          return result([{
            pending_count: 0,
            dead_count: 1,
            suppressed_count: 0,
            last_delivered_at: null,
            error_code: "dm_delivery_indeterminate",
          }]);
        }
        return result([]);
      }),
    } as unknown as Pool;
    const send = vi.fn();
    const worker = new DiscordCommunityNotificationWorker({
      pool,
      gateway: {
        subscribeGuildMemberJoin: vi.fn(() => vi.fn()),
      } as unknown as DiscordGatewayClient,
      publisher: { send },
      siteUrl: "https://www.alphatraders.co.il",
      guildId: event.guildId,
      pollIntervalMs: 60_000,
    });

    await worker.start();
    await worker.shutdown();

    const claimQuery = queries.find(({ sql }) =>
      sql.includes("with indeterminate as"));
    expect(claimQuery?.sql).toContain("dm_delivery_indeterminate");
    expect(claimQuery?.sql).toContain("dm_delivery_outcome_unknown");
    expect(claimQuery?.sql).toContain("$1 * interval '1 minute'");
    expect(claimQuery?.sql).not.toContain("interval '3 minutes'");
    expect(claimQuery?.sql).toContain("updated_at < now()");
    expect(claimQuery?.sql).toContain("updated_at >= now()");
    expect(claimQuery?.values).toEqual([3]);
    expect(send).not.toHaveBeenCalled();
    expect(worker.getDiagnostics()).toMatchObject({
      status: "degraded",
      deadCount: 1,
      errorCode: "dm_delivery_indeterminate",
    });
  });

  it("keeps notification delivery online when retention maintenance fails", async () => {
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("cleanup_discord_community_state")) {
          throw new Error("retention unavailable");
        }
        if (sql.includes("update alpha_exchange.discord_notification_deliveries delivery")) {
          return result([]);
        }
        if (sql.includes("count(*) filter")) {
          return result([{
            pending_count: 0,
            dead_count: 0,
            suppressed_count: 0,
            last_delivered_at: null,
            error_code: null,
          }]);
        }
        return result([]);
      }),
    } as unknown as Pool;
    const worker = new DiscordCommunityNotificationWorker({
      pool,
      gateway: {
        subscribeGuildMemberJoin: vi.fn(() => vi.fn()),
      } as unknown as DiscordGatewayClient,
      publisher: { send: vi.fn() },
      siteUrl: "https://www.alphatraders.co.il",
      guildId: event.guildId,
      pollIntervalMs: 60_000,
    });

    await expect(worker.start()).resolves.toBeUndefined();
    await worker.shutdown();
    expect(worker.getDiagnostics().status).toBe("ready");
  });
});
