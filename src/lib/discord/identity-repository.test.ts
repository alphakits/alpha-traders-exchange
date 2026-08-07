// @vitest-environment node

import type { Pool, PoolClient, QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  consumeDiscordOAuthState,
  DiscordIdentityConflictError,
  linkDiscordIdentity,
  unlinkDiscordIdentity,
} from "@/lib/discord/identity-repository";

function result<T>(rows: T[]): QueryResult<T> {
  return {
    command: "",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

describe("Discord identity repository", () => {
  it("atomically consumes state with expiry, replay, and same-user binding predicates", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(result([{ code_challenge: "challenge", locale: "en" }]))
      .mockResolvedValueOnce(result([]));
    const pool = { query } as unknown as Pool;

    await expect(consumeDiscordOAuthState({
      stateHash: "hash",
      platformUserId: "alpha-user",
      pool,
    })).resolves.toEqual({ codeChallenge: "challenge", locale: "en" });
    await expect(consumeDiscordOAuthState({
      stateHash: "hash",
      platformUserId: "alpha-user",
      pool,
    })).resolves.toBeNull();

    const [sql, values] = query.mock.calls[0] as [string, string[]];
    expect(sql).toContain("platform_user_id = $2");
    expect(sql).toContain("consumed_at is null");
    expect(sql).toContain("expires_at > now()");
    expect(values).toEqual(["hash", "alpha-user"]);
  });

  it("maps a database uniqueness race to a safe identity conflict", async () => {
    const uniqueViolation = Object.assign(new Error("duplicate"), { code: "23505" });
    const query = vi.fn(async (sql: string) => {
      if (sql === "begin" || sql === "rollback") return result([]);
      if (sql.includes("from alpha_exchange.discord_identities")) return result([]);
      if (sql.includes("select seller_status")) {
        return result([{ seller_status: "approved_seller" }]);
      }
      if (sql.includes("insert into alpha_exchange.discord_identities")) {
        throw uniqueViolation;
      }
      return result([]);
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

    await expect(linkDiscordIdentity({
      platformUserId: "alpha-user",
      profile: {
        id: "987654321098765432",
        username: "alpha",
        globalName: "Alpha",
      },
      pool,
    })).rejects.toBeInstanceOf(DiscordIdentityConflictError);
    expect(query).toHaveBeenCalledWith("rollback");
  });

  it("locks the Alpha account before reading the identity to serialize concurrent callbacks", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes("select seller_status")) {
        return result([{ seller_status: "approved_seller" }]);
      }
      if (sql.includes("from alpha_exchange.discord_identities")) return result([]);
      return result([]);
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

    await linkDiscordIdentity({
      platformUserId: "alpha-user",
      profile: {
        id: "987654321098765432",
        username: "alpha",
        globalName: "Alpha",
      },
      pool,
    });

    const userLock = statements.findIndex((sql) =>
      sql.includes("select seller_status") && sql.includes("for update"));
    const identityRead = statements.findIndex((sql) =>
      sql.includes("from alpha_exchange.discord_identities"));
    expect(userLock).toBeGreaterThan(-1);
    expect(userLock).toBeLessThan(identityRead);
  });

  it("deletes the identity transactionally so the database revocation trigger can queue removal", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes("returning discord_user_id")) {
        return result([{ discord_user_id: "987654321098765432" }]);
      }
      return result([]);
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

    await expect(unlinkDiscordIdentity({
      platformUserId: "alpha-user",
      pool,
    })).resolves.toBe(true);

    const deleteIndex = statements.findIndex((sql) =>
      sql.includes("delete from alpha_exchange.discord_identities"));
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(statements[deleteIndex]).toContain("returning discord_user_id");
    const auditCall = query.mock.calls.find(([sql]) =>
      String(sql).includes("insert into alpha_exchange.discord_sync_audit"));
    expect(auditCall?.[1]).toEqual(["alpha-user", "987654321098765432"]);
    expect(statements.indexOf("commit")).toBeGreaterThan(deleteIndex);
  });

  it("treats repeated unlink as an idempotent no-op without another audit", async () => {
    const query = vi.fn(async () => result([]));
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;

    await expect(unlinkDiscordIdentity({
      platformUserId: "alpha-user",
      pool,
    })).resolves.toBe(false);

    expect(query).toHaveBeenCalledWith("commit");
    expect(query.mock.calls.some(([sql]) =>
      String(sql).includes("discord_sync_audit"))).toBe(false);
  });
});
