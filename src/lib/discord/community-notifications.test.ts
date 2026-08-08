// @vitest-environment node

import type { Pool, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildDiscordApprovedSellerMessage,
  buildDiscordWelcomeMessage,
  DiscordCommunityNotificationWorker,
  DiscordDirectMessageError,
  enqueueDiscordWelcome,
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

  it("records DM-disabled as terminal suppression instead of retrying forever", async () => {
    let claimCount = 0;
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        if (sql.includes("with candidate as")) {
          claimCount += 1;
          return claimCount === 1
            ? result([{
                id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                notification_type: "welcome",
                discord_user_id: event.discordUserId,
                lease_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                attempts: 1,
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
});
