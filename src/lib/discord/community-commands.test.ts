// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import type { ChatInputCommandInteraction, REST } from "discord.js";
import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DISCORD_COMMUNITY_COMMAND_DEFINITION_HASH,
  DISCORD_COMMUNITY_COMMAND_NAMES,
  DISCORD_COMMUNITY_COMMANDS,
  DiscordCommunityCommandService,
} from "@/lib/discord/community-commands";
import type { DiscordGatewayClient } from "@/lib/discord/gateway-client";

function result<T extends QueryResultRow>(
  rows: T[],
  rowCount = rows.length,
): QueryResult<T> {
  return { command: "", rowCount, oid: 0, fields: [], rows };
}

const applicationId = "1".repeat(18);
const guildId = "2".repeat(18);
const userId = "3".repeat(18);

function gatewayFixture() {
  return {
    subscribeInteraction: vi.fn(() => vi.fn()),
  } as unknown as DiscordGatewayClient;
}

function withCommandLock(pool: Pool): Pool {
  const query = pool.query.bind(pool);
  Object.assign(pool, {
    connect: vi.fn(async () => ({
      query,
      release: vi.fn(),
    })),
  });
  return pool;
}

describe("Discord community commands", () => {
  it("defines exactly seven deterministic guild-only commands", () => {
    expect(DISCORD_COMMUNITY_COMMAND_NAMES).toEqual([
      "market",
      "profile",
      "listing",
      "share",
      "website",
      "help",
      "pulse",
    ]);
    expect(DISCORD_COMMUNITY_COMMANDS).toHaveLength(7);
    expect(DISCORD_COMMUNITY_COMMANDS.every((command) =>
      command.dm_permission === false)).toBe(true);
    expect(DISCORD_COMMUNITY_COMMAND_DEFINITION_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it("destroys and releases the pooled client when advisory unlock fails", async () => {
    const unlockError = new Error("unlock failed");
    const release = vi.fn();
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("pg_advisory_unlock")) throw unlockError;
        if (sql.includes("select command_name")) {
          throw new Error("registry unavailable");
        }
        return result([]);
      }),
      release,
    } as unknown as PoolClient;
    const service = new DiscordCommunityCommandService({
      pool: {
        connect: vi.fn(async () => client),
      } as unknown as Pool,
      gateway: gatewayFixture(),
      token: "test-token",
      applicationId,
      guildId,
      siteUrl: "https://www.alphatraders.co.il",
      rest: {
        get: vi.fn(async () => []),
      } as unknown as REST,
    });

    await expect(service.reconcile()).rejects.toBe(unlockError);
    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith(true);
  });

  it("reconciles idempotently and never removes an unregistered command", async () => {
    const remote: Record<string, unknown>[] = [{
      id: "9".repeat(18),
      application_id: applicationId,
      name: "admin",
      description: "Unrelated command",
      type: 1,
      options: [],
    }, {
      id: "8".repeat(18),
      application_id: applicationId,
      name: "legacy-alpha",
      description: "Previously owned command",
      type: 1,
      options: [],
    }];
    const rest = {
      get: vi.fn(async () => remote),
      post: vi.fn(async (_route: string, input: { body: Record<string, unknown> }) => {
        const command = {
          id: String(remote.length + 10).padStart(18, "0"),
          application_id: applicationId,
          ...input.body,
          options: input.body.options ?? [],
        };
        remote.push(command);
        return command;
      }),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    const registry = new Map<string, {
      commandId: string | null;
      definitionHash: string;
    }>([
      ["legacy-alpha", {
        commandId: "8".repeat(18),
        definitionHash: "0".repeat(64),
      }],
    ]);
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("select command_name")) {
          return result([...registry].map(([command_name, discord_command_id]) => ({
            command_name,
            discord_command_id: discord_command_id.commandId,
            definition_hash: discord_command_id.definitionHash,
            reconciled_at: new Date(),
          })));
        }
        if (sql.includes("delete from alpha_exchange.discord_command_registry")) {
          registry.delete(String(values?.[0]));
        }
        if (sql.includes("insert into alpha_exchange.discord_command_registry")) {
          const name = String(values?.[0]);
          if (sql.includes("values ($1, null, $2")) {
            registry.set(name, {
              commandId: null,
              definitionHash: String(values?.[1]),
            });
          } else {
            registry.set(name, {
              commandId: String(values?.[1]),
              definitionHash: String(values?.[2]),
            });
          }
        }
        return result([], 1);
      }),
    } as unknown as Pool;
    const service = new DiscordCommunityCommandService({
      pool: withCommandLock(pool),
      gateway: gatewayFixture(),
      token: "test-token",
      applicationId,
      guildId,
      siteUrl: "https://www.alphatraders.co.il",
      rest: rest as unknown as REST,
    });

    await service.reconcile();
    await service.reconcile();

    expect(rest.post).toHaveBeenCalledTimes(7);
    expect(rest.patch).not.toHaveBeenCalled();
    expect(rest.delete).toHaveBeenCalledOnce();
    expect(remote.map((command) => command.name)).toContain("admin");
    expect(rest.delete).not.toHaveBeenCalledWith(expect.stringContaining(
      "9".repeat(18),
    ));
  });

  it("updates a drifted command only when its registry ID proves ownership", async () => {
    const ownedId = "8".repeat(18);
    const remote = [{
      id: ownedId,
      application_id: applicationId,
      name: "market",
      description: "Old owned definition",
      type: 1,
      options: [],
    }];
    const rest = {
      get: vi.fn(async () => remote),
      post: vi.fn(async (_route: string, input: { body: Record<string, unknown> }) => ({
        id: String(remote.length + 10).padStart(18, "0"),
        application_id: applicationId,
        ...input.body,
        options: input.body.options ?? [],
      })),
      patch: vi.fn(async (_route: string, input: { body: Record<string, unknown> }) => ({
        ...remote[0],
        ...input.body,
      })),
      delete: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string) =>
        sql.includes("select command_name")
          ? result([{
              command_name: "market",
              discord_command_id: ownedId,
              definition_hash: "0".repeat(64),
              reconciled_at: new Date(),
            }])
          : result([], 1)),
    } as unknown as Pool;
    const service = new DiscordCommunityCommandService({
      pool: withCommandLock(pool),
      gateway: gatewayFixture(),
      token: "test-token",
      applicationId,
      guildId,
      siteUrl: "https://www.alphatraders.co.il",
      rest: rest as unknown as REST,
    });

    await service.reconcile();

    expect(rest.patch).toHaveBeenCalledOnce();
    expect(rest.patch.mock.calls[0]?.[0]).toContain(ownedId);
    expect(rest.post).toHaveBeenCalledTimes(6);
  });

  it("reports an unowned desired-name collision without mutating any command", async () => {
    const unownedId = "7".repeat(18);
    const remote = [{
      id: unownedId,
      application_id: applicationId,
      name: "market",
      description: "Unmanaged command",
      type: 1,
      options: [],
    }, {
      id: "9".repeat(18),
      application_id: applicationId,
      name: "admin",
      description: "Unrelated command",
      type: 1,
      options: [],
    }];
    const rest = {
      get: vi.fn(async () => remote),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string) =>
        sql.includes("select command_name") ? result([]) : result([], 1)),
    } as unknown as Pool;
    const service = new DiscordCommunityCommandService({
      pool: withCommandLock(pool),
      gateway: gatewayFixture(),
      token: "test-token",
      applicationId,
      guildId,
      siteUrl: "https://www.alphatraders.co.il",
      rest: rest as unknown as REST,
    });

    await expect(service.reconcile()).rejects.toThrow(
      "unowned_command_name_conflict",
    );

    expect(service.getDiagnostics()).toMatchObject({
      status: "degraded",
      errorCode: "unowned_command_name_conflict",
    });
    expect(rest.post).not.toHaveBeenCalled();
    expect(rest.patch).not.toHaveBeenCalled();
    expect(rest.delete).not.toHaveBeenCalled();
  });

  it("recovers a command created after a durable reservation when the process crashes", async () => {
    const remote: Record<string, unknown>[] = [];
    const registry = new Map<string, {
      commandId: string | null;
      definitionHash: string;
    }>();
    let crashAfterFirstCreate = true;
    const rest = {
      get: vi.fn(async () => remote),
      post: vi.fn(async (
        _route: string,
        input: { body: Record<string, unknown> },
      ) => {
        const command = {
          id: String(remote.length + 10).padStart(18, "0"),
          application_id: applicationId,
          ...input.body,
          options: input.body.options ?? [],
        };
        remote.push(command);
        if (crashAfterFirstCreate) {
          crashAfterFirstCreate = false;
          throw new Error("simulated_process_crash");
        }
        return command;
      }),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes("select command_name")) {
          return result([...registry].map(([command_name, entry]) => ({
            command_name,
            discord_command_id: entry.commandId,
            definition_hash: entry.definitionHash,
            reconciled_at: new Date(),
          })));
        }
        if (
          sql.includes("update alpha_exchange.discord_command_registry")
          && sql.includes("discord_command_id is null")
        ) {
          const entry = registry.get(String(values?.[0]));
          if (!entry || entry.commandId !== null) return result([], 0);
          entry.commandId = String(values?.[1]);
          return result([], 1);
        }
        if (sql.includes("insert into alpha_exchange.discord_command_registry")) {
          const name = String(values?.[0]);
          if (sql.includes("values ($1, null, $2")) {
            if (!registry.has(name)) {
              registry.set(name, {
                commandId: null,
                definitionHash: String(values?.[1]),
              });
            }
          } else {
            registry.set(name, {
              commandId: String(values?.[1]),
              definitionHash: String(values?.[2]),
            });
          }
          return result([], 1);
        }
        return result([], 1);
      }),
    } as unknown as Pool;
    const service = new DiscordCommunityCommandService({
      pool: withCommandLock(pool),
      gateway: gatewayFixture(),
      token: "test-token",
      applicationId,
      guildId,
      siteUrl: "https://www.alphatraders.co.il",
      rest: rest as unknown as REST,
    });

    await expect(service.reconcile()).rejects.toThrow(
      "simulated_process_crash",
    );
    await expect(service.reconcile()).resolves.toBeUndefined();

    expect(remote.filter((command) => command.name === "market")).toHaveLength(
      1,
    );
    expect(rest.patch).not.toHaveBeenCalled();
    expect(service.getDiagnostics().status).toBe("ready");
  });

  it("recovers a version-skewed reservation before patching the owned command", async () => {
    const oldCommand = {
      id: "6".repeat(18),
      application_id: applicationId,
      name: "market",
      description: "Old reserved definition",
      type: 1,
      dm_permission: false,
      options: [],
    };
    const oldHash = createHash("sha256").update(JSON.stringify({
      name: oldCommand.name,
      description: oldCommand.description,
      type: oldCommand.type,
      dm_permission: false,
      options: [],
    })).digest("hex");
    const rest = {
      get: vi.fn(async () => [oldCommand]),
      post: vi.fn(async (
        _route: string,
        input: { body: Record<string, unknown> },
      ) => ({
        id: crypto.randomUUID().replaceAll("-", "").slice(0, 18),
        application_id: applicationId,
        ...input.body,
        options: input.body.options ?? [],
      })),
      patch: vi.fn(async (
        _route: string,
        input: { body: Record<string, unknown> },
      ) => ({ ...oldCommand, ...input.body })),
      delete: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("select command_name")) {
          return result([{
            command_name: "market",
            discord_command_id: null,
            definition_hash: oldHash,
          }]);
        }
        return result([], 1);
      }),
    } as unknown as Pool;
    const service = new DiscordCommunityCommandService({
      pool: withCommandLock(pool),
      gateway: gatewayFixture(),
      token: "test-token",
      applicationId,
      guildId,
      siteUrl: "https://www.alphatraders.co.il",
      rest: rest as unknown as REST,
    });

    await service.reconcile();

    expect(rest.patch).toHaveBeenCalledOnce();
    expect(rest.patch.mock.calls[0]?.[0]).toContain(oldCommand.id);
    expect(rest.delete).not.toHaveBeenCalled();
  });

  it("waits instead of creating across an unexpired version-skewed reservation", async () => {
    const rest = {
      get: vi.fn(async () => []),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("select command_name")) {
          return result([{
            command_name: "market",
            discord_command_id: null,
            definition_hash: "0".repeat(64),
          }]);
        }
        if (sql.includes("reconciled_at <=")) return result([], 0);
        return result([], 1);
      }),
    } as unknown as Pool;
    const service = new DiscordCommunityCommandService({
      pool: withCommandLock(pool),
      gateway: gatewayFixture(),
      token: "test-token",
      applicationId,
      guildId,
      siteUrl: "https://www.alphatraders.co.il",
      rest: rest as unknown as REST,
    });

    await expect(service.reconcile()).rejects.toThrow(
      "command_reconciliation_pending",
    );

    expect(rest.post).not.toHaveBeenCalled();
    expect(rest.patch).not.toHaveBeenCalled();
    expect(rest.delete).not.toHaveBeenCalled();
  });

  it("defers ephemerally before database work and routes share only to the website", async () => {
    const order: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        order.push("database");
        if (sql.includes("discord_interaction_claims") && sql.includes("select 1")) {
          return result([]);
        }
        if (sql.includes("discord_command_rate_limits") && sql.includes("for update")) {
          return result([]);
        }
        return result([], 1);
      }),
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql: string) => {
        if (sql.includes("discord_identities")) {
          return result([{ platform_user_id: "platform-user" }]);
        }
        if (sql.includes("discord_listing_share_cooldowns")) {
          return result([{
            next_eligible_at: new Date(Date.now() + 3_600_000),
            server_time: new Date(),
          }]);
        }
        return result([]);
      }),
    } as unknown as Pool;
    const editReply = vi.fn();
    const interaction = {
      applicationId,
      guildId,
      commandName: "share",
      id: "4".repeat(18),
      user: { id: userId },
      options: { getString: vi.fn(() => null) },
      deferReply: vi.fn(async (input) => {
        order.push("defer");
        expect(input).toEqual({ flags: 64 });
      }),
      editReply,
    } as unknown as ChatInputCommandInteraction;
    const service = new DiscordCommunityCommandService({
      pool,
      gateway: gatewayFixture(),
      token: "test-token",
      applicationId,
      guildId,
      siteUrl: "https://www.alphatraders.co.il",
      rest: {} as REST,
    });

    await service.handle(interaction);

    expect(order[0]).toBe("defer");
    const response = editReply.mock.calls[0]?.[0];
    expect(JSON.stringify(response)).toContain("https://www.alphatraders.co.il");
    expect(JSON.stringify(response)).toContain("cannot reset or bypass");
    expect(JSON.stringify(response)).not.toMatch(
      /platform-user|interaction.token|email|wallet/i,
    );
    const source = readFileSync(
      path.join(process.cwd(), "src", "lib", "discord", "community-commands.ts"),
      "utf8",
    );
    expect(source).not.toContain("claimDiscordListingShare");
    expect(source).not.toContain("DiscordListingPublisher");
  });

  it("rejects invalid guild/application/command context without touching state", async () => {
    const pool = {
      connect: vi.fn(),
      query: vi.fn(),
    } as unknown as Pool;
    const editReply = vi.fn();
    const interaction = {
      applicationId,
      guildId: "8".repeat(18),
      commandName: "help",
      id: "4".repeat(18),
      user: { id: userId },
      deferReply: vi.fn(async () => undefined),
      editReply,
    } as unknown as ChatInputCommandInteraction;
    const service = new DiscordCommunityCommandService({
      pool,
      gateway: gatewayFixture(),
      token: "test-token",
      applicationId,
      guildId,
      siteUrl: "https://www.alphatraders.co.il",
      rest: {} as REST,
    });

    await service.handle(interaction);
    expect(editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: "This command is not available in this context.",
    }));
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it.each([
    {
      state: "replayed",
      expected: "already handled",
      replayRows: [{ "?column?": 1 }],
      rateRows: [],
    },
    {
      state: "rate limited",
      expected: "Please wait",
      replayRows: [],
      rateRows: [{
        window_started_at: new Date(),
        request_count: 5,
      }],
    },
  ])("returns a safe response for $state interactions", async ({
    expected,
    replayRows,
    rateRows,
  }) => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("discord_interaction_claims") && sql.includes("select 1")) {
          return result(replayRows);
        }
        if (sql.includes("discord_command_rate_limits") && sql.includes("for update")) {
          return result(rateRows);
        }
        return result([], 1);
      }),
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(),
    } as unknown as Pool;
    const editReply = vi.fn();
    const interaction = {
      applicationId,
      guildId,
      commandName: "help",
      id: "4".repeat(18),
      user: { id: userId },
      options: { getString: vi.fn(() => null) },
      deferReply: vi.fn(async () => undefined),
      editReply,
    } as unknown as ChatInputCommandInteraction;
    const service = new DiscordCommunityCommandService({
      pool,
      gateway: gatewayFixture(),
      token: "test-token",
      applicationId,
      guildId,
      siteUrl: "https://www.alphatraders.co.il",
      rest: {} as REST,
    });

    await service.handle(interaction);
    expect(editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining(expected),
    }));
  });

  it("bounds the initial defer window before any database work", async () => {
    vi.useFakeTimers();
    const pool = {
      connect: vi.fn(),
      query: vi.fn(),
    } as unknown as Pool;
    const interaction = {
      applicationId,
      guildId,
      commandName: "help",
      id: "4".repeat(18),
      user: { id: userId },
      deferReply: vi.fn(() => new Promise(() => undefined)),
      editReply: vi.fn(),
    } as unknown as ChatInputCommandInteraction;
    const service = new DiscordCommunityCommandService({
      pool,
      gateway: gatewayFixture(),
      token: "test-token",
      applicationId,
      guildId,
      siteUrl: "https://www.alphatraders.co.il",
      rest: {} as REST,
    });

    try {
      const response = service.handle(interaction);
      const rejection = expect(response).rejects.toThrow(
        "interaction_response_timeout",
      );
      await vi.advanceTimersByTimeAsync(2_501);
      await rejection;
      expect(pool.connect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
