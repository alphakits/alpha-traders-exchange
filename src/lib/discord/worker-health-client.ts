import "server-only";

import {
  DISCORD_SAFE_ERROR_MESSAGES,
  degradedDiscordDiagnostics,
  type DiscordDiagnosticErrorCode,
  type DiscordDiagnostics,
  type DiscordReadyState,
} from "@/lib/discord/diagnostics";
import { logEvent } from "@/lib/structured-logging";
import {
  DiscordWorkerConfigurationError,
  readDiscordWorkerProxyConfig,
} from "@/lib/discord/worker-config";
import { createDiscordWorkerAuthHeaders } from "@/lib/discord/worker-health-auth";
import type { EnvironmentValues } from "@/lib/env-validation";

const WORKER_DIAGNOSTICS_TIMEOUT_MS = 3_000;
const WORKER_ERROR_CODES = new Set<DiscordDiagnosticErrorCode>([
  "configuration_invalid",
  "login_failed",
  "application_mismatch",
  "guild_verification_failed",
  "gateway_error",
  "service_stopped",
]);
const READY_STATES = new Set<DiscordReadyState>([
  "idle",
  "starting",
  "ready",
  "reconnecting",
  "disconnected",
  "error",
  "stopping",
  "stopped",
]);

type WorkerHealthClientDependencies = {
  env?: EnvironmentValues;
  fetch?: typeof fetch;
  now?: () => number;
  createNonce?: () => string;
  timeoutMs?: number;
};

function nullableString(value: unknown, maxLength: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maxLength) return undefined;
  return value;
}

function nullableNonNegativeNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
  ) {
    return undefined;
  }
  return value;
}

function parseWorkerDiagnostics(value: unknown): DiscordDiagnostics | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.status !== "healthy" && candidate.status !== "degraded")
    || typeof candidate.connected !== "boolean"
    || typeof candidate.readyState !== "string"
    || !READY_STATES.has(candidate.readyState as DiscordReadyState)
  ) {
    return null;
  }

  const botUsername = nullableString(candidate.botUsername, 128);
  const guildName = nullableString(candidate.guildName, 256);
  const guildId = nullableString(candidate.guildId, 20);
  const apiLatencyMs = nullableNonNegativeNumber(candidate.apiLatencyMs);
  const connectionUptimeMs = nullableNonNegativeNumber(candidate.connectionUptimeMs);
  if (
    botUsername === undefined
    || guildName === undefined
    || guildId === undefined
    || (guildId !== null && !/^\d{17,20}$/.test(guildId))
    || apiLatencyMs === undefined
    || connectionUptimeMs === undefined
  ) {
    return null;
  }

  let error: DiscordDiagnostics["error"] = null;
  if (candidate.error !== null) {
    if (!candidate.error || typeof candidate.error !== "object") return null;
    const errorCode = (candidate.error as Record<string, unknown>).code;
    if (
      typeof errorCode !== "string"
      || !WORKER_ERROR_CODES.has(errorCode as DiscordDiagnosticErrorCode)
    ) {
      return null;
    }
    error = {
      code: errorCode as DiscordDiagnosticErrorCode,
      message:
        DISCORD_SAFE_ERROR_MESSAGES[errorCode as DiscordDiagnosticErrorCode],
    };
  }

  return {
    status: candidate.status,
    connected: candidate.connected,
    readyState: candidate.readyState as DiscordReadyState,
    botUsername,
    guildName,
    guildId,
    apiLatencyMs,
    connectionUptimeMs,
    error,
  };
}

function recordProxyFailure(
  code: DiscordDiagnosticErrorCode,
  error?: unknown,
): DiscordDiagnostics {
  logEvent("warn", {
    event: "discord_worker_diagnostics_failed",
    outcome: "failed",
    reason: code,
    metadata: error
      ? { errorType: error instanceof Error ? error.name : typeof error }
      : {},
  });
  return degradedDiscordDiagnostics(code);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error
    && (error.name === "AbortError" || error.name === "TimeoutError");
}

export async function fetchDiscordWorkerDiagnostics({
  env = process.env,
  fetch: fetchImpl = fetch,
  now,
  createNonce,
  timeoutMs = WORKER_DIAGNOSTICS_TIMEOUT_MS,
}: WorkerHealthClientDependencies = {}): Promise<DiscordDiagnostics> {
  let config;
  try {
    config = readDiscordWorkerProxyConfig(env);
  } catch (error) {
    if (error instanceof DiscordWorkerConfigurationError) {
      return recordProxyFailure("worker_configuration_invalid", error);
    }
    throw error;
  }

  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/health/ready`, {
      method: "GET",
      headers: createDiscordWorkerAuthHeaders(
        config.healthSecret,
        now,
        createNonce,
      ),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return recordProxyFailure(
      isTimeoutError(error) ? "worker_timeout" : "worker_unavailable",
      error,
    );
  }

  if (response.status === 401 || response.status === 403) {
    return recordProxyFailure("worker_authentication_failed");
  }
  if (response.status !== 200 && response.status !== 503) {
    return recordProxyFailure("worker_unavailable");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    return recordProxyFailure("worker_response_invalid", error);
  }
  const diagnostics = parseWorkerDiagnostics(payload);
  if (!diagnostics) {
    return recordProxyFailure("worker_response_invalid");
  }
  return diagnostics;
}
