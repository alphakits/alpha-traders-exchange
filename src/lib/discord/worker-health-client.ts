import "server-only";

import {
  DISCORD_SAFE_ERROR_MESSAGES,
  degradedDiscordDiagnostics,
  type DiscordDiagnosticErrorCode,
  type DiscordDiagnostics,
  type DiscordListingDiagnostics,
  type DiscordMarketIntelligenceDiagnostics,
  type DiscordResourceDiagnostics,
  type DiscordReadyState,
  type DiscordCommunityCommandDiagnostics,
  type DiscordCommunityNotificationDiagnostics,
  type DiscordDeploymentDiagnostics,
} from "@/lib/discord/diagnostics";
import { logEvent } from "@/lib/structured-logging";
import {
  DiscordWorkerConfigurationError,
  readDiscordWorkerProxyConfig,
} from "@/lib/discord/worker-config";
import {
  createDiscordWorkerAuthHeaders,
  DISCORD_WORKER_AUTH_HEADERS,
  verifyDiscordWorkerResponse,
} from "@/lib/discord/worker-health-auth";
import type { EnvironmentValues } from "@/lib/env-validation";

const WORKER_DIAGNOSTICS_TIMEOUT_MS = 3_000;
const WORKER_ERROR_CODES = new Set<DiscordDiagnosticErrorCode>([
  "configuration_invalid",
  "login_failed",
  "privileged_intent_required",
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

function parseResourceDiagnostics(
  value: unknown,
): DiscordResourceDiagnostics | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.status !== "ready" && candidate.status !== "degraded") {
    return null;
  }
  const totalCount = nullableNonNegativeNumber(candidate.totalCount);
  const readyCount = nullableNonNegativeNumber(candidate.readyCount);
  const missingCount = nullableNonNegativeNumber(candidate.missingCount);
  const errorCode = nullableString(candidate.errorCode, 64);
  if (
    totalCount === undefined
    || readyCount === undefined
    || missingCount === undefined
    || errorCode === undefined
    || (totalCount !== null && !Number.isInteger(totalCount))
    || (readyCount !== null && !Number.isInteger(readyCount))
    || (missingCount !== null && !Number.isInteger(missingCount))
    || (errorCode !== null && !/^[a-z0-9_]+$/.test(errorCode))
  ) {
    return null;
  }
  if (
    candidate.status === "ready"
    && (
      totalCount === null
      || readyCount !== totalCount
      || missingCount !== 0
      || errorCode !== null
    )
  ) {
    return null;
  }
  return {
    status: candidate.status,
    totalCount,
    readyCount,
    missingCount,
    errorCode,
  };
}

function parseListingDiagnostics(value: unknown): DiscordListingDiagnostics | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.status !== "ready" && candidate.status !== "degraded") return null;
  const pendingJobs = nullableNonNegativeNumber(candidate.pendingJobs);
  const deadJobs = nullableNonNegativeNumber(candidate.deadJobs);
  const activeMappings = nullableNonNegativeNumber(candidate.activeMappings);
  const failedMappings = nullableNonNegativeNumber(candidate.failedMappings);
  const cooldownClaims = nullableNonNegativeNumber(candidate.cooldownClaims);
  const errorCode = nullableString(candidate.errorCode, 64);
  if (
    pendingJobs === undefined
    || deadJobs === undefined
    || activeMappings === undefined
    || failedMappings === undefined
    || cooldownClaims === undefined
    || errorCode === undefined
    || [pendingJobs, deadJobs, activeMappings, failedMappings, cooldownClaims]
      .some((count) => count !== null && !Number.isInteger(count))
    || (errorCode !== null && !/^[a-z0-9_]+$/.test(errorCode))
  ) {
    return null;
  }
  return {
    status: candidate.status,
    pendingJobs,
    deadJobs,
    activeMappings,
    failedMappings,
    cooldownClaims,
    errorCode,
  };
}

function parseMarketIntelligenceDiagnostics(
  value: unknown,
): DiscordMarketIntelligenceDiagnostics | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.status !== "ready" && candidate.status !== "degraded") return null;
  const activeCount = nullableNonNegativeNumber(candidate.activeCount);
  const pendingCount = nullableNonNegativeNumber(candidate.pendingCount);
  const deadCount = nullableNonNegativeNumber(candidate.deadCount);
  const lastSuccessAt = nullableString(candidate.lastSuccessAt, 40);
  const errorCode = nullableString(candidate.errorCode, 64);
  if (
    activeCount === undefined
    || pendingCount === undefined
    || deadCount === undefined
    || lastSuccessAt === undefined
    || errorCode === undefined
    || [activeCount, pendingCount, deadCount]
      .some((count) => count !== null && !Number.isInteger(count))
    || (
      lastSuccessAt !== null
      && (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(lastSuccessAt)
        || !Number.isFinite(Date.parse(lastSuccessAt))
      )
    )
    || (errorCode !== null && !/^[a-z0-9_]+$/.test(errorCode))
  ) {
    return null;
  }

  return {
    status: candidate.status,
    activeCount,
    pendingCount,
    deadCount,
    lastSuccessAt,
    errorCode,
  };
}

function parseNotificationDiagnostics(
  value: unknown,
): DiscordCommunityNotificationDiagnostics | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.status !== "ready" && candidate.status !== "degraded") return null;
  const pendingCount = nullableNonNegativeNumber(candidate.pendingCount);
  const deadCount = nullableNonNegativeNumber(candidate.deadCount);
  const suppressedCount = nullableNonNegativeNumber(candidate.suppressedCount);
  const lastDeliveredAt = nullableString(candidate.lastDeliveredAt, 40);
  const errorCode = nullableString(candidate.errorCode, 64);
  if (
    pendingCount === undefined
    || deadCount === undefined
    || suppressedCount === undefined
    || lastDeliveredAt === undefined
    || errorCode === undefined
    || [pendingCount, deadCount, suppressedCount]
      .some((countValue) => countValue !== null && !Number.isInteger(countValue))
    || (
      lastDeliveredAt !== null
      && (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(lastDeliveredAt)
        || !Number.isFinite(Date.parse(lastDeliveredAt))
      )
    )
    || (errorCode !== null && !/^[a-z0-9_]+$/.test(errorCode))
  ) {
    return null;
  }
  return {
    status: candidate.status,
    pendingCount,
    deadCount,
    suppressedCount,
    lastDeliveredAt,
    errorCode,
  };
}

function parseCommandDiagnostics(
  value: unknown,
): DiscordCommunityCommandDiagnostics | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.status !== "ready" && candidate.status !== "degraded") return null;
  const registeredCount = nullableNonNegativeNumber(candidate.registeredCount);
  const definitionHash = nullableString(candidate.definitionHash, 64);
  const lastReconciledAt = nullableString(candidate.lastReconciledAt, 40);
  const errorCode = nullableString(candidate.errorCode, 64);
  if (
    registeredCount === undefined
    || definitionHash === undefined
    || lastReconciledAt === undefined
    || errorCode === undefined
    || (registeredCount !== null && !Number.isInteger(registeredCount))
    || (definitionHash !== null && !/^[0-9a-f]{64}$/.test(definitionHash))
    || (
      lastReconciledAt !== null
      && (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(lastReconciledAt)
        || !Number.isFinite(Date.parse(lastReconciledAt))
      )
    )
    || (errorCode !== null && !/^[a-z0-9_]+$/.test(errorCode))
  ) {
    return null;
  }
  return {
    status: candidate.status,
    registeredCount,
    definitionHash,
    lastReconciledAt,
    errorCode,
  };
}

function parseDeploymentDiagnostics(
  value: unknown,
): DiscordDeploymentDiagnostics | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.source !== "railway" && candidate.source !== "local") return null;
  const revision = nullableString(candidate.revision, 64);
  const environment = nullableString(candidate.environment, 32);
  if (
    revision === undefined
    || environment === undefined
    || (revision !== null && !/^[0-9a-f]{7,64}$/.test(revision))
    || (environment !== null && !/^[a-z0-9][a-z0-9_-]{0,31}$/i.test(environment))
  ) {
    return null;
  }
  return { source: candidate.source, revision, environment };
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
  let resources: DiscordResourceDiagnostics | undefined;
  if (candidate.resources !== undefined) {
    const parsed = parseResourceDiagnostics(candidate.resources);
    if (!parsed) return null;
    resources = parsed;
  }
  let listings: DiscordListingDiagnostics | undefined;
  if (candidate.listings !== undefined) {
    const parsed = parseListingDiagnostics(candidate.listings);
    if (!parsed) return null;
    listings = parsed;
  }
  let marketIntelligence: DiscordMarketIntelligenceDiagnostics | undefined;
  if (candidate.marketIntelligence !== undefined) {
    const parsed = parseMarketIntelligenceDiagnostics(
      candidate.marketIntelligence,
    );
    if (!parsed) return null;
    marketIntelligence = parsed;
  }
  let notifications: DiscordCommunityNotificationDiagnostics | undefined;
  if (candidate.notifications !== undefined) {
    const parsed = parseNotificationDiagnostics(candidate.notifications);
    if (!parsed) return null;
    notifications = parsed;
  }
  let commands: DiscordCommunityCommandDiagnostics | undefined;
  if (candidate.commands !== undefined) {
    const parsed = parseCommandDiagnostics(candidate.commands);
    if (!parsed) return null;
    commands = parsed;
  }
  let deployment: DiscordDeploymentDiagnostics | undefined;
  if (candidate.deployment !== undefined) {
    const parsed = parseDeploymentDiagnostics(candidate.deployment);
    if (!parsed) return null;
    deployment = parsed;
  }
  let requiredPrivilegedIntents: readonly ["GuildMembers"] | undefined;
  if (candidate.requiredPrivilegedIntents !== undefined) {
    if (
      !Array.isArray(candidate.requiredPrivilegedIntents)
      || candidate.requiredPrivilegedIntents.length !== 1
      || candidate.requiredPrivilegedIntents[0] !== "GuildMembers"
    ) {
      return null;
    }
    requiredPrivilegedIntents = ["GuildMembers"];
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
    ...(resources ? { resources } : {}),
    ...(listings ? { listings } : {}),
    ...(marketIntelligence ? { marketIntelligence } : {}),
    ...(notifications ? { notifications } : {}),
    ...(commands ? { commands } : {}),
    ...(deployment ? { deployment } : {}),
    ...(requiredPrivilegedIntents ? { requiredPrivilegedIntents } : {}),
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
    const authHeaders = createDiscordWorkerAuthHeaders(
      config.healthSecret,
      now,
      createNonce,
    );
    response = await fetchImpl(`${config.baseUrl}/health/ready`, {
      method: "GET",
      headers: authHeaders,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401 || response.status === 403) {
      return recordProxyFailure("worker_authentication_failed");
    }
    const body = await response.text();
    if (!verifyDiscordWorkerResponse({
      headers: response.headers,
      secret: config.healthSecret,
      requestNonce: authHeaders[DISCORD_WORKER_AUTH_HEADERS.nonce],
      statusCode: response.status,
      body,
      now,
    })) {
      return recordProxyFailure("worker_response_authentication_failed");
    }
    if (response.status !== 200 && response.status !== 503) {
      return recordProxyFailure("worker_unavailable");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch (error) {
      return recordProxyFailure("worker_response_invalid", error);
    }
    const diagnostics = parseWorkerDiagnostics(payload);
    if (!diagnostics) {
      return recordProxyFailure("worker_response_invalid");
    }
    return diagnostics;
  } catch (error) {
    return recordProxyFailure(
      isTimeoutError(error) ? "worker_timeout" : "worker_unavailable",
      error,
    );
  }
}
