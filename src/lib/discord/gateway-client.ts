import "server-only";

import {
  Client,
  Events,
  GatewayIntentBits,
  type CloseEvent,
} from "discord.js";

export type DiscordGatewayEvent =
  | { type: "ready" }
  | { type: "disconnect"; code: number }
  | { type: "reconnecting" }
  | { type: "resume" }
  | { type: "error"; error: unknown };

export type DiscordGatewayIdentity = {
  username: string;
  applicationId: string;
};

export type DiscordGuildIdentity = {
  id: string;
  name: string;
};

export interface DiscordGatewayClient {
  subscribe(listener: (event: DiscordGatewayEvent) => void): () => void;
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
  private loginPromise: Promise<void> | null = null;
  private sessionStarted = false;

  constructor() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds],
    });

    this.client.on(Events.ClientReady, () => this.emit({ type: "ready" }));
    this.client.on(Events.ShardDisconnect, (event: CloseEvent) => {
      this.emit({ type: "disconnect", code: event.code });
    });
    this.client.on(Events.ShardReconnecting, () => this.emit({ type: "reconnecting" }));
    this.client.on(Events.ShardResume, () => this.emit({ type: "resume" }));
    this.client.on(Events.Error, (error) => this.emit({ type: "error", error }));
    this.client.on(Events.ShardError, (error) => this.emit({ type: "error", error }));
  }

  subscribe(listener: (event: DiscordGatewayEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
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
    const ready = this.waitUntilReady();
    try {
      await this.client.login(token);
      await ready.promise;
      this.sessionStarted = true;
    } finally {
      ready.cancel();
    }
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
