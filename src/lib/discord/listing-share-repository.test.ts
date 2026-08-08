// @vitest-environment node

import type { Pool, PoolClient, QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  claimDiscordListingShare,
  DiscordListingShareError,
  getDiscordListingSharingStatus,
} from "@/lib/discord/listing-share-repository";

function result<T>(rows: T[]): QueryResult<T> {
  return {
    command: "",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

describe("Discord listing share repository", () => {
  it("returns server-clock cooldown state without exposing Discord IDs", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("select now() as server_time")) {
        return result([{
          server_time: new Date("2026-08-08T00:00:00.000Z"),
          next_eligible_at: new Date("2026-08-08T01:00:00.000Z"),
          linked: true,
        }]);
      }
      return result([{
        id: "mapping-private",
        listing_id: "listing-public",
        state: "active",
        published_at: new Date("2026-08-07T13:00:00.000Z"),
        updated_at: new Date("2026-08-07T13:00:00.000Z"),
        last_error_code: null,
      }]);
    });
    const pool = { query } as unknown as Pool;

    const sharing = await getDiscordListingSharingStatus("seller-1", pool);
    expect(sharing.cooldownSecondsRemaining).toBe(3600);
    expect(sharing.listings[0]).toEqual({
      listingId: "listing-public",
      state: "active",
      publishedAt: "2026-08-07T13:00:00.000Z",
      updatedAt: "2026-08-07T13:00:00.000Z",
      errorCode: null,
    });
    expect(JSON.stringify(sharing)).not.toContain("mapping-private");
  });

  it("atomically claims a 12-hour window and queues one fenced publish", async () => {
    const statements: string[] = [];
    const now = new Date("2026-08-08T00:00:00.000Z");
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql === "begin" || sql === "commit") return result([]);
      if (sql.includes("select pg_advisory_xact_lock")) return result([]);
      if (sql.includes("from alpha_exchange.users users")) {
        return result([{ seller_status: "approved_seller", disabled: false, linked: true }]);
      }
      if (sql.includes("from alpha_exchange.listings")) {
        return result([{
          id: "listing-1",
          seller_id: "seller-1",
          status: "active",
          expires_at: new Date("2026-08-09T00:00:00.000Z"),
          payload: { approvalStatus: "approved", availableAmount: "500" },
        }]);
      }
      if (sql === "select now() as server_time") return result([{ server_time: now }]);
      if (sql.includes("from alpha_exchange.discord_managed_resources")) {
        return result([{ guild_id: "1".repeat(18), discord_resource_id: "2".repeat(18) }]);
      }
      if (sql.includes("where cooldown.request_key")) return result([]);
      if (sql.includes("from alpha_exchange.discord_listing_share_cooldowns") && sql.includes("for update")) return result([]);
      if (sql.includes("state = any($2::text[])") && sql.includes("limit 1")) return result([]);
      if (sql.includes("returning id::text")) return result([{ id: "123e4567-e89b-42d3-a456-426614174000" }]);
      if (sql.includes("select now() as server_time,")) {
        return result([{
          server_time: now,
          next_eligible_at: new Date("2026-08-08T12:00:00.000Z"),
          linked: true,
        }]);
      }
      if (sql.includes("select distinct on (listing_id)")) {
        return result([{
          id: "123e4567-e89b-42d3-a456-426614174000",
          listing_id: "listing-1",
          state: "queued",
          published_at: null,
          updated_at: now,
          last_error_code: null,
        }]);
      }
      return result([]);
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

    const claimed = await claimDiscordListingShare({
      sellerId: "seller-1",
      listingId: "listing-1",
      requestKey: "request-key-123456789",
      pool,
    });

    expect(claimed.accepted).toBe(true);
    expect(statements.some((sql) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(statements.some((sql) => sql.includes("discord_listing_outbox"))).toBe(true);
    expect(statements.some((sql) => sql.includes("interval '12 hours'"))).toBe(true);
    expect(statements.at(-1)).toBe("commit");
  });

  it("blocks another listing during the rolling cooldown without resetting it", async () => {
    const now = new Date("2026-08-08T00:00:00.000Z");
    const query = vi.fn(async (sql: string) => {
      if (sql === "begin" || sql === "commit") return result([]);
      if (sql.includes("select pg_advisory_xact_lock")) return result([]);
      if (sql.includes("from alpha_exchange.users users")) {
        return result([{ seller_status: "approved_seller", disabled: false, linked: true }]);
      }
      if (sql.includes("from alpha_exchange.listings")) {
        return result([{
          id: "listing-2",
          seller_id: "seller-1",
          status: "active",
          expires_at: new Date("2026-08-09T00:00:00.000Z"),
          payload: { approvalStatus: "approved", availableAmount: "500" },
        }]);
      }
      if (sql === "select now() as server_time") return result([{ server_time: now }]);
      if (sql.includes("from alpha_exchange.discord_managed_resources")) {
        return result([{ guild_id: "1".repeat(18), discord_resource_id: "2".repeat(18) }]);
      }
      if (sql.includes("where cooldown.request_key")) return result([]);
      if (sql.includes("discord_listing_share_cooldowns") && sql.includes("for update")) {
        return result([{ next_eligible_at: new Date("2026-08-08T11:59:59.000Z") }]);
      }
      if (sql.includes("state = any($2::text[])")) return result([]);
      if (sql.includes("select now() as server_time,")) {
        return result([{
          server_time: now,
          next_eligible_at: new Date("2026-08-08T11:59:59.000Z"),
          linked: true,
        }]);
      }
      return result([]);
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

    await expect(claimDiscordListingShare({
      sellerId: "seller-1",
      listingId: "listing-2",
      requestKey: "request-key-987654321",
      pool,
    })).rejects.toMatchObject<Partial<DiscordListingShareError>>({
      code: "SHARE_COOLDOWN_ACTIVE",
      status: 429,
    });
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("insert into alpha_exchange.discord_listing_messages"))).toBe(false);
    expect(query).toHaveBeenCalledWith("commit");
  });

  it("rejects forged ownership and malformed replay keys before publishing", async () => {
    await expect(claimDiscordListingShare({
      sellerId: "seller-1",
      listingId: "listing-1",
      requestKey: "short",
      pool: { connect: vi.fn() } as unknown as Pool,
    })).rejects.toMatchObject({ code: "INVALID_REQUEST_KEY", status: 400 });
  });
});
