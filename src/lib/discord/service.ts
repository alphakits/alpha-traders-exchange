import type {
  DiscordGatewayClient,
  DiscordGatewayEvent,
  DiscordGuildIdentity,
} from "@/lib/discord/gateway-client";
import {
  DiscordConfigurationError,
  readDiscordConfig,
  type DiscordConfig,
} from "@/lib/discord/config";
import {
  DISCORD_SAFE_ERROR_MESSAGES,
  type DiscordDiagnosticErrorCode,
  type DiscordDiagnostics,
  type DiscordReadyState,
  type DiscordSafeError,
} from "@/lib/discord/diagnostics";
import { logEvent } from "@/lib/structured-logging";
import type { EnvironmentValues } from "@/lib/env-validation";

export class DiscordServiceError extends Error {
  readonly code: DiscordDiagnosticErrorCode;

  constructor(code: DiscordDiagnosticErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DiscordServiceError";
    this.code = code;
  }
}

type DiscordServiceDependencies = {
  gateway: DiscordGatewayClient;
  env?: EnvironmentValues;
  now?: () => number;
};

function serviceError(
  code: DiscordDiagnosticErrorCode,
  cause?: unknown,
): DiscordServiceError {
  return new DiscordServiceError(code, DISCORD_SAFE_ERROR_MESSAGES[code], { cause });
}

function errorMetadata(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { errorType: typeof error };
  const candidate = error as Error & { code?: string | number };
  return {
    errorType: error.name,
    errorCode: candidate.code,
  };
}

export class DiscordService {
  private readonly gateway: DiscordGatewayClient;
  private readonly env: EnvironmentValues;
  private readonly now: () => number;
  private readonly unsubscribe: () => void;
  private readyState: DiscordReadyState = "idle";
  private readySince: number | null = null;
  private guild: DiscordGuildIdentity | null = null;
  private botUsername: string | null = null;
  private lastError: DiscordSafeError | null = null;
  private startPromise: Promise<DiscordDiagnostics> | null = null;
  private stopPromise: Promise<void> | null = null;
  private gatewaySessionStarted = false;

  constructor({ gateway, env = process.env, now = Date.now }: DiscordServiceDependencies) {
    this.gateway = gateway;
    this.env = env;
    this.now = now;
    this.unsubscribe = this.gateway.subscribe((event) => this.handleGatewayEvent(event));
  }

  start(): Promise<DiscordDiagnostics> {
    if (this.readyState === "stopped" || this.readyState === "stopping") {
      const error = serviceError("service_stopped");
      this.recordError(error);
      return Promise.reject(error);
    }
    if (this.readyState === "ready" && this.gateway.isReady() && this.guild) {
      return Promise.resolve(this.getDiagnostics());
    }
    if (this.gatewaySessionStarted && !this.gateway.isReady()) {
      return Promise.resolve(this.getDiagnostics());
    }
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.performStart().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  getDiagnostics(): DiscordDiagnostics {
    const connected = this.gateway.isReady();
    const connectionUptimeMs =
      connected && this.readySince !== null
        ? Math.max(0, this.now() - this.readySince)
        : null;
    const healthy =
      connected
      && this.readyState === "ready"
      && this.guild !== null
      && this.lastError === null;

    return {
      status: healthy ? "healthy" : "degraded",
      connected,
      readyState: this.readyState,
      botUsername: this.botUsername,
      guildName: this.guild?.name ?? null,
      guildId: this.guild?.id ?? null,
      apiLatencyMs: connected ? this.gateway.getLatencyMs() : null,
      connectionUptimeMs,
      error: this.lastError,
    };
  }

  shutdown(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (this.readyState === "stopped") return Promise.resolve();

    this.stopPromise = Promise.resolve().then(() => {
      this.readyState = "stopping";
      this.readySince = null;
      this.gateway.destroy();
      this.unsubscribe();
      this.readyState = "stopped";
      logEvent("info", {
        event: "discord_gateway_shutdown",
        outcome: "success",
      });
    });
    return this.stopPromise;
  }

  private async performStart(): Promise<DiscordDiagnostics> {
    this.readyState = "starting";
    this.lastError = null;

    let config: DiscordConfig;
    try {
      config = readDiscordConfig(this.env);
    } catch (error) {
      const mapped = error instanceof DiscordConfigurationError
        ? serviceError("configuration_invalid", error)
        : serviceError("configuration_invalid");
      this.recordError(mapped, errorMetadata(error));
      throw mapped;
    }

    if (!this.gateway.isReady()) {
      try {
        await this.gateway.login(config.token);
        this.gatewaySessionStarted = true;
      } catch (error) {
        const mapped = serviceError("login_failed", error);
        this.recordError(mapped, errorMetadata(error));
        throw mapped;
      }
    }
    this.throwIfStopped();

    const identity = this.gateway.getIdentity();
    if (!identity || identity.applicationId !== config.applicationId) {
      const mapped = serviceError("application_mismatch");
      this.recordError(mapped);
      throw mapped;
    }
    this.botUsername = identity.username;
    if (this.readySince === null) this.readySince = this.now();

    let guild: DiscordGuildIdentity;
    try {
      guild = await this.gateway.fetchGuild(config.guildId);
    } catch (error) {
      const mapped = serviceError("guild_verification_failed", error);
      this.recordError(mapped, errorMetadata(error));
      throw mapped;
    }
    this.throwIfStopped();
    this.guild = guild;

    this.readyState = "ready";
    this.lastError = null;
    const diagnostics = this.getDiagnostics();
    logEvent("info", {
      event: "discord_gateway_ready",
      outcome: "success",
      metadata: {
        botUsername: diagnostics.botUsername,
        guildName: diagnostics.guildName,
        guildId: diagnostics.guildId,
        connectionStatus: diagnostics.readyState,
        apiLatencyMs: diagnostics.apiLatencyMs,
      },
    });
    return diagnostics;
  }

  private handleGatewayEvent(event: DiscordGatewayEvent): void {
    if (this.readyState === "stopping" || this.readyState === "stopped") return;

    switch (event.type) {
      case "ready":
        this.readySince = this.now();
        this.gatewaySessionStarted = true;
        if (this.guild) {
          this.readyState = "ready";
          this.lastError = null;
        }
        logEvent("info", {
          event: "discord_gateway_connected",
          outcome: "success",
          metadata: { sinceLoginMs: event.sinceLoginMs },
        });
        return;
      case "disconnect":
        this.readyState = "disconnected";
        this.readySince = null;
        logEvent("warn", {
          event: "discord_gateway_disconnected",
          outcome: "failed",
          metadata: {
            closeCode: event.code,
            sinceLoginMs: event.sinceLoginMs,
          },
        });
        return;
      case "reconnecting":
        this.readyState = "reconnecting";
        this.readySince = null;
        logEvent("info", {
          event: "discord_gateway_reconnecting",
          outcome: "success",
          metadata: { sinceLoginMs: event.sinceLoginMs },
        });
        return;
      case "resume":
        this.readyState = this.guild ? "ready" : "starting";
        this.readySince = this.now();
        this.lastError = null;
        logEvent("info", {
          event: "discord_gateway_resumed",
          outcome: "success",
          metadata: {
            connectionStatus: this.readyState,
            sinceLoginMs: event.sinceLoginMs,
          },
        });
        return;
      case "error": {
        const mapped = serviceError("gateway_error", event.error);
        if (!this.gateway.isReady()) {
          this.lastError = { code: mapped.code, message: mapped.message };
          this.readyState = "error";
          this.readySince = null;
        }
        logEvent("error", {
          event: "discord_gateway_error",
          outcome: "failed",
          metadata: {
            ...errorMetadata(event.error),
            sinceLoginMs: event.sinceLoginMs,
          },
        });
      }
    }
  }

  private recordError(
    error: DiscordServiceError,
    metadata: Record<string, unknown> = {},
  ): void {
    if (this.readyState === "stopping" || this.readyState === "stopped") return;
    this.readyState = "error";
    this.lastError = { code: error.code, message: error.message };
    logEvent("error", {
      event: "discord_service_start_failed",
      outcome: "failed",
      reason: error.code,
      metadata,
    });
  }

  private throwIfStopped(): void {
    if (this.readyState === "stopping" || this.readyState === "stopped") {
      throw serviceError("service_stopped");
    }
  }
}

export type {
  DiscordDiagnosticErrorCode,
  DiscordDiagnostics,
  DiscordReadyState,
  DiscordSafeError,
} from "@/lib/discord/diagnostics";
