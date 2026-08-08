import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DiscordGatewayClient,
  DiscordGatewayEvent,
  DiscordGuildMemberJoin,
} from "@/lib/discord/gateway-client";
import type { ChatInputCommandInteraction } from "discord.js";
import {
  DiscordService,
  DiscordServiceError,
} from "@/lib/discord/service";

const applicationId = "1".repeat(18);
const guildId = "2".repeat(18);

function validEnv(): Readonly<Record<string, string | undefined>> {
  return {
    DISCORD_BOT_TOKEN: "unit-test-credential",
    DISCORD_APPLICATION_ID: applicationId,
    DISCORD_GUILD_ID: guildId,
  };
}

class MockGateway implements DiscordGatewayClient {
  readonly login = vi.fn(async () => {
    this.ready = true;
    this.emit({ type: "ready" });
  });
  readonly fetchGuild = vi.fn(async (id: string) => ({
    id,
    name: "Test Guild",
  }));
  readonly destroy = vi.fn();
  readonly subscribers = new Set<(event: DiscordGatewayEvent) => void>();
  ready = false;
  latency = 42;

  subscribe(listener: (event: DiscordGatewayEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  subscribeGuildMemberJoin(
    listener: (event: DiscordGuildMemberJoin) => void,
  ): () => void {
    void listener;
    return () => undefined;
  }

  subscribeInteraction(
    listener: (interaction: ChatInputCommandInteraction) => void,
  ): () => void {
    void listener;
    return () => undefined;
  }

  isReady(): boolean {
    return this.ready;
  }

  getIdentity() {
    return this.ready
      ? { username: "test-bot", applicationId }
      : null;
  }

  getLatencyMs(): number {
    return this.latency;
  }

  emit(event: DiscordGatewayEvent): void {
    if (event.type === "disconnect" || event.type === "reconnecting") {
      this.ready = false;
    }
    if (event.type === "ready" || event.type === "resume") {
      this.ready = true;
    }
    for (const subscriber of this.subscribers) subscriber(event);
  }
}

describe("DiscordService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shares one startup promise across concurrent callers", async () => {
    const gateway = new MockGateway();
    const service = new DiscordService({ gateway, env: validEnv() });

    const [first, second, third] = await Promise.all([
      service.start(),
      service.start(),
      service.start(),
    ]);

    expect(gateway.subscribers).toHaveLength(1);
    expect(gateway.login).toHaveBeenCalledTimes(1);
    expect(gateway.fetchGuild).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(first.status).toBe("healthy");
  });

  it("verifies the configured guild through the gateway client", async () => {
    const gateway = new MockGateway();
    const service = new DiscordService({ gateway, env: validEnv() });

    const diagnostics = await service.start();

    expect(gateway.fetchGuild).toHaveBeenCalledWith(guildId);
    expect(diagnostics.guildId).toBe(guildId);
    expect(diagnostics.guildName).toBe("Test Guild");
  });

  it("resets ready-session uptime across disconnect and resume", async () => {
    let now = 1_000;
    const gateway = new MockGateway();
    const service = new DiscordService({
      gateway,
      env: validEnv(),
      now: () => now,
    });
    await service.start();

    now = 1_750;
    expect(service.getDiagnostics().connectionUptimeMs).toBe(750);

    gateway.emit({ type: "disconnect", code: 1_000 });
    expect(service.getDiagnostics()).toMatchObject({
      connected: false,
      readyState: "disconnected",
      connectionUptimeMs: null,
    });

    gateway.emit({ type: "reconnecting" });
    const duringReconnect = await service.start();
    expect(duringReconnect.readyState).toBe("reconnecting");
    expect(gateway.login).toHaveBeenCalledTimes(1);

    now = 5_000;
    gateway.emit({ type: "resume" });
    now = 5_400;
    expect(service.getDiagnostics()).toMatchObject({
      connected: true,
      readyState: "ready",
      connectionUptimeMs: 400,
    });
  });

  it("recovers from gateway errors when the gateway is ready again", async () => {
    const gateway = new MockGateway();
    const service = new DiscordService({ gateway, env: validEnv() });
    await service.start();

    gateway.ready = false;
    gateway.emit({ type: "error", error: new Error("transient shard failure") });
    expect(service.getDiagnostics()).toMatchObject({
      status: "degraded",
      readyState: "error",
      error: { code: "gateway_error" },
    });

    gateway.emit({ type: "ready" });
    expect(service.getDiagnostics()).toMatchObject({
      status: "healthy",
      connected: true,
      readyState: "ready",
      error: null,
    });

    gateway.emit({ type: "error", error: new Error("non-fatal client event") });
    expect(service.getDiagnostics()).toMatchObject({
      status: "healthy",
      readyState: "ready",
      error: null,
    });
  });

  it("returns only a fixed safe diagnostic when login fails", async () => {
    const gateway = new MockGateway();
    gateway.login.mockRejectedValueOnce(
      new Error("request failed with credential unit-test-credential"),
    );
    const service = new DiscordService({ gateway, env: validEnv() });

    await expect(service.start()).rejects.toMatchObject({
      code: "login_failed",
    });

    const serialized = JSON.stringify(service.getDiagnostics());
    expect(serialized).toContain("Discord gateway login failed.");
    expect(serialized).not.toContain("unit-test-credential");
    expect(serialized).not.toContain("request failed");
  });

  it("reports the GuildMembers portal toggle as an explicit startup blocker", async () => {
    const gateway = new MockGateway();
    gateway.login.mockRejectedValueOnce(
      Object.assign(new Error("disallowed intent"), { code: 4014 }),
    );
    const service = new DiscordService({ gateway, env: validEnv() });

    await expect(service.start()).rejects.toMatchObject({
      code: "privileged_intent_required",
    });
    expect(service.getDiagnostics()).toMatchObject({
      error: { code: "privileged_intent_required" },
      requiredPrivilegedIntents: ["GuildMembers"],
    });
  });

  it("reports missing configuration names without exposing configured values", async () => {
    const gateway = new MockGateway();
    const service = new DiscordService({
      gateway,
      env: { DISCORD_BOT_TOKEN: "unit-test-credential" },
    });

    await expect(service.start()).rejects.toMatchObject({
      code: "configuration_invalid",
    });
    const serialized = JSON.stringify(service.getDiagnostics());
    expect(serialized).toContain("DISCORD_APPLICATION_ID");
    expect(serialized).toContain("DISCORD_GUILD_ID");
    expect(serialized).not.toContain("unit-test-credential");
    expect(gateway.login).not.toHaveBeenCalled();
  });

  it("reports a safe degraded error when forced guild verification fails", async () => {
    const gateway = new MockGateway();
    gateway.fetchGuild.mockRejectedValueOnce(new Error("raw provider response"));
    const service = new DiscordService({ gateway, env: validEnv() });

    await expect(service.start()).rejects.toBeInstanceOf(DiscordServiceError);
    expect(service.getDiagnostics()).toMatchObject({
      status: "degraded",
      connected: true,
      readyState: "error",
      error: {
        code: "guild_verification_failed",
        message: "The configured Discord guild could not be verified.",
      },
    });
    expect(JSON.stringify(service.getDiagnostics())).not.toContain("raw provider response");
  });

  it("destroys the client once during graceful shutdown", async () => {
    const gateway = new MockGateway();
    const service = new DiscordService({ gateway, env: validEnv() });
    await service.start();

    await Promise.all([service.shutdown(), service.shutdown()]);

    expect(gateway.destroy).toHaveBeenCalledTimes(1);
    expect(gateway.subscribers).toHaveLength(0);
    expect(service.getDiagnostics().readyState).toBe("stopped");
  });

  it("keeps stopped state when shutdown races an in-flight guild verification", async () => {
    const gateway = new MockGateway();
    let resolveGuild!: (guild: { id: string; name: string }) => void;
    gateway.fetchGuild.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveGuild = resolve;
      }),
    );
    const service = new DiscordService({ gateway, env: validEnv() });
    const startup = service.start();
    await vi.waitFor(() => expect(gateway.fetchGuild).toHaveBeenCalledOnce());

    await service.shutdown();
    resolveGuild({ id: guildId, name: "Test Guild" });

    await expect(startup).rejects.toMatchObject({ code: "service_stopped" });
    expect(service.getDiagnostics().readyState).toBe("stopped");
    await expect(service.start()).rejects.toMatchObject({ code: "service_stopped" });
    expect(gateway.login).toHaveBeenCalledTimes(1);
  });
});
