// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";

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
    let registryReads = 0;
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("select command_name")) {
          registryReads += 1;
          return result(registryReads === 1
            ? [{
                command_name: "legacy-alpha",
                discord_command_id: "8".repeat(18),
              }]
            : []);
        }
        return result([], 1);
      }),
    } as unknown as Pool;
    const service = new DiscordCommunityCommandService({
      pool,
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
