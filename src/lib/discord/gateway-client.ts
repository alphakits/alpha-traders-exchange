import "server-only";

import {
  Client,
  Events,
  GatewayIntentBits,
  type ChatInputCommandInteraction,
  type CloseEvent,
} from "discord.js";
import { performance } from "node:perf_hooks";

import { logEvent } from "@/lib/structured-logging";

export type DiscordGatewayEvent =
  | { type: "ready"; sinceLoginMs?: number }
  | { type: "disconnect"; code: number; sinceLoginMs?: number }
  | { type: "reconnecting"; sinceLoginMs?: number }
  | { type: "resume"; sinceLoginMs?: number }
  | { type: "error"; error: unknown; sinceLoginMs?: number };

export type DiscordGatewayIdentity = {
  username: string;
  applicationId: string;
};

export type DiscordGuildIdentity = {
  id: string;
  name: string;
};

export type DiscordGuildMemberJoin = {
  guildId: string;
  discordUserId: string;
  joinedAt: string;
  isBot: boolean;
};

export interface DiscordGatewayClient {
  subscribe(listener: (event: DiscordGatewayEvent) => void): () => void;
  subscribeGuildMemberJoin(
    listener: (event: DiscordGuildMemberJoin) => void,
  ): () => void;
  subscribeInteraction(
    listener: (interaction: ChatInputCommandInteraction) => void,
  ): () => void;
  login(token: string): Promise<void>;
  isReady(): boolean;
  getIdentity(): DiscordGatewayIdentity | null;
  fetchGuild(guildId: string): Promise<DiscordGuildIdentity>;
  getLatencyMs(): number | null;
  destroy(): void;
}

const READY_TIMEOUT_MS = 20_000;

export class DiscordJsGatewayClient implements DiscordGatewayClient {
  private readonly client: Client;
  private readonly subscribers = new Set<(event: DiscordGatewayEvent) => void>();
  private readonly memberJoinSubscribers = new Set<
    (event: DiscordGuildMemberJoin) => void
  >();
  private readonly interactionSubscribers = new Set<
    (interaction: ChatInputCommandInteraction) => void
  >();
  private loginPromise: Promise<void> | null = null;
  private sessionStarted = false;
  private loginStartedAt: number | null = null;

  constructor() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    });

    this.client.on(Events.ClientReady, () => {
      this.emit({ type: "ready", sinceLoginMs: this.loginElapsedMs() });
    });
    this.client.on(Events.ShardDisconnect, (event: CloseEvent) => {
      this.emit({
        type: "disconnect",
        code: event.code,
        sinceLoginMs: this.loginElapsedMs(),
      });
    });
    this.client.on(Events.ShardReconnecting, () => {
      this.emit({ type: "reconnecting", sinceLoginMs: this.loginElapsedMs() });
    });
    this.client.on(Events.ShardResume, () => {
      this.emit({ type: "resume", sinceLoginMs: this.loginElapsedMs() });
    });
    this.client.on(Events.Error, (error) => {
      this.emit({ type: "error", error, sinceLoginMs: this.loginElapsedMs() });
    });
    this.client.on(Events.ShardError, (error) => {
      this.emit({ type: "error", error, sinceLoginMs: this.loginElapsedMs() });
    });
    this.client.on(Events.GuildMemberAdd, (member) => {
      if (!member.joinedAt) {
        logEvent("warn", {
          event: "discord_member_join_ignored",
          outcome: "failed",
          reason: "missing_join_timestamp",
        });
        return;
      }
      const event = {
        guildId: member.guild.id,
        discordUserId: member.id,
        joinedAt: member.joinedAt.toISOString(),
        isBot: member.user.bot,
      };
      for (const subscriber of this.memberJoinSubscribers) subscriber(event);
    });
    this.client.on(Events.InteractionCreate, (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      for (const subscriber of this.interactionSubscribers) {
        subscriber(interaction);
      }
    });
  }

  subscribe(listener: (event: DiscordGatewayEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  subscribeGuildMemberJoin(
    listener: (event: DiscordGuildMemberJoin) => void,
  ): () => void {
    this.memberJoinSubscribers.add(listener);
    return () => this.memberJoinSubscribers.delete(listener);
  }

  subscribeInteraction(
    listener: (interaction: ChatInputCommandInteraction) => void,
  ): () => void {
    this.interactionSubscribers.add(listener);
    return () => this.interactionSubscribers.delete(listener);
  }

  async login(token: string): Promise<void> {
    if (this.sessionStarted || this.client.isReady()) return;
    if (this.loginPromise) return this.loginPromise;

    this.loginPromise = this.performLogin(token).finally(() => {
      this.loginPromise = null;
    });
    return this.loginPromise;
  }

  isReady(): boolean {
    return this.client.isReady();
  }

  getIdentity(): DiscordGatewayIdentity | null {
    if (!this.client.user || !this.client.application) return null;
    return {
      username: this.client.user.username,
      applicationId: this.client.application.id,
    };
  }

  async fetchGuild(guildId: string): Promise<DiscordGuildIdentity> {
    const guild = await this.client.guilds.fetch({ guild: guildId, force: true });
    return { id: guild.id, name: guild.name };
  }

  getLatencyMs(): number | null {
    const latency = this.client.ws.ping;
    return Number.isFinite(latency) && latency >= 0 ? Math.round(latency) : null;
  }

  destroy(): void {
    this.client.destroy();
  }

  private emit(event: DiscordGatewayEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  private async performLogin(token: string): Promise<void> {
    this.loginStartedAt = performance.now();
    logEvent("info", {
      event: "discord_gateway_login_started",
      outcome: "success",
      metadata: { readyTimeoutMs: READY_TIMEOUT_MS },
    });
    const ready = this.waitUntilReady();
    try {
      const login = this.client.login(token);
      await Promise.all([login, ready.promise]);
      this.sessionStarted = true;
      logEvent("info", {
        event: "discord_gateway_login_ready",
        outcome: "success",
        metadata: { elapsedMs: this.loginElapsedMs() },
      });
    } catch (error) {
      logEvent("error", {
        event: "discord_gateway_login_failed",
        outcome: "failed",
        metadata: {
          elapsedMs: this.loginElapsedMs(),
          errorType: error instanceof Error ? error.name : typeof error,
        },
      });
      throw error;
    } finally {
      ready.cancel();
    }
  }

  private loginElapsedMs(): number | undefined {
    if (this.loginStartedAt === null) return undefined;
    return Math.max(0, Math.round(performance.now() - this.loginStartedAt));
  }

  private waitUntilReady(): { promise: Promise<void>; cancel: () => void } {
    if (this.client.isReady()) {
      return { promise: Promise.resolve(), cancel: () => undefined };
    }

    let unsubscribe: () => void = () => undefined;
    let timeout: ReturnType<typeof setTimeout>;
    const promise = new Promise<void>((resolve, reject) => {
      unsubscribe = this.subscribe((event) => {
        if (event.type === "ready") {
          clearTimeout(timeout);
          unsubscribe();
          resolve();
        } else if (event.type === "disconnect" && event.code === 4014) {
          clearTimeout(timeout);
          unsubscribe();
          reject(Object.assign(
            new Error("Discord Guild Members privileged intent is not enabled."),
            { code: 4014 },
          ));
        }
      });

      timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("Discord gateway ready timeout."));
      }, READY_TIMEOUT_MS);
    });

    return {
      promise,
      cancel: () => {
        clearTimeout(timeout);
        unsubscribe();
      },
    };
  }
}
