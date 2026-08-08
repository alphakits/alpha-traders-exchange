// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const client = {
    application: { id: "2".repeat(18) },
    guilds: {
      fetch: vi.fn(async () => ({ id: "3".repeat(18), name: "Test Guild" })),
    },
    isReady: vi.fn(() => false),
    login: vi.fn<() => Promise<string>>(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
      return client;
    }),
    user: { username: "test-bot" },
    ws: { ping: 42 },
    destroy: vi.fn(),
  };
  return {
    client,
    clientConstructor: vi.fn(function ClientMock() {
      return client;
    }),
    listeners,
    logEvent: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.logEvent }));
vi.mock("discord.js", () => ({
  Client: mocks.clientConstructor,
  Events: {
    ClientReady: "clientReady",
    Error: "error",
    ShardDisconnect: "shardDisconnect",
    ShardError: "shardError",
    ShardReconnecting: "shardReconnecting",
    ShardResume: "shardResume",
    GuildMemberAdd: "guildMemberAdd",
    InteractionCreate: "interactionCreate",
  },
  GatewayIntentBits: { Guilds: 1, GuildMembers: 2 },
}));

import { DiscordJsGatewayClient } from "@/lib/discord/gateway-client";

describe("DiscordJsGatewayClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.listeners.clear();
    mocks.logEvent.mockClear();
    mocks.client.on.mockClear();
    mocks.client.destroy.mockClear();
    mocks.client.isReady.mockReset().mockReturnValue(false);
    mocks.client.login.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("turns a ready timeout into a handled login rejection while discord.js is pending", async () => {
    let rejectLogin: (error: Error) => void = () => undefined;
    mocks.client.login.mockReturnValue(new Promise((_, reject) => {
      rejectLogin = reject;
    }));
    const gateway = new DiscordJsGatewayClient();
    const unhandledRejection = vi.fn();
    process.on("unhandledRejection", unhandledRejection);

    try {
      const startup = gateway.login("unit-test-token");
      const rejection = expect(startup).rejects.toThrow("Discord gateway ready timeout.");
      await vi.advanceTimersByTimeAsync(20_001);

      await rejection;
      rejectLogin(new Error("late discord.js rejection"));
      await vi.advanceTimersByTimeAsync(0);
      expect(unhandledRejection).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandledRejection);
    }
    expect(JSON.stringify(mocks.logEvent.mock.calls)).not.toContain("unit-test-token");
    expect(mocks.logEvent).toHaveBeenCalledWith("error", expect.objectContaining({
      event: "discord_gateway_login_failed",
      outcome: "failed",
      metadata: expect.objectContaining({
        errorType: "Error",
      }),
    }));
  });

  it("fails immediately with code 4014 when GuildMembers is not enabled", async () => {
    mocks.client.login.mockReturnValue(new Promise(() => undefined));
    const gateway = new DiscordJsGatewayClient();
    const startup = gateway.login("unit-test-token");

    mocks.listeners.get("shardDisconnect")?.({ code: 4014 });

    await expect(startup).rejects.toMatchObject({ code: 4014 });
  });

  it("waits for both discord.js login and the ready event", async () => {
    let resolveLogin: (token: string) => void = () => undefined;
    mocks.client.login.mockReturnValue(new Promise((resolve) => {
      resolveLogin = resolve;
    }));
    const gateway = new DiscordJsGatewayClient();

    const startup = gateway.login("unit-test-token");
    mocks.client.isReady.mockReturnValue(true);
    mocks.listeners.get("clientReady")?.();
    resolveLogin("unit-test-token");

    await expect(startup).resolves.toBeUndefined();
    expect(gateway.isReady()).toBe(true);
    expect(mocks.logEvent).toHaveBeenCalledWith("info", expect.objectContaining({
      event: "discord_gateway_login_ready",
      outcome: "success",
    }));
  });

  it("requests only Guilds and GuildMembers without MessageContent", () => {
    new DiscordJsGatewayClient();
    expect(mocks.clientConstructor).toHaveBeenCalledWith({ intents: [1, 2] });
  });

  it("subscribes to member joins and interactions without exposing message content", () => {
    const gateway = new DiscordJsGatewayClient();
    const onJoin = vi.fn();
    const onInteraction = vi.fn();
    const removeJoin = gateway.subscribeGuildMemberJoin(onJoin);
    const removeInteraction = gateway.subscribeInteraction(onInteraction);
    const interaction = {
      isChatInputCommand: () => true,
    };

    mocks.listeners.get("guildMemberAdd")?.({
      guild: { id: "1".repeat(18) },
      id: "2".repeat(18),
      joinedAt: new Date("2026-08-08T05:00:00.000Z"),
      user: { bot: false },
    });
    mocks.listeners.get("interactionCreate")?.(interaction);

    expect(onJoin).toHaveBeenCalledWith({
      guildId: "1".repeat(18),
      discordUserId: "2".repeat(18),
      joinedAt: "2026-08-08T05:00:00.000Z",
      isBot: false,
    });
    expect(onInteraction).toHaveBeenCalledWith(interaction);

    removeJoin();
    removeInteraction();
    mocks.listeners.get("interactionCreate")?.(interaction);
    expect(onInteraction).toHaveBeenCalledOnce();
  });
});
