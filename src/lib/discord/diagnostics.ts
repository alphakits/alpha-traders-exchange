export type DiscordReadyState =
  | "idle"
  | "starting"
  | "ready"
  | "reconnecting"
  | "disconnected"
  | "error"
  | "stopping"
  | "stopped";

export type DiscordDiagnosticErrorCode =
  | "configuration_invalid"
  | "login_failed"
  | "privileged_intent_required"
  | "application_mismatch"
  | "guild_verification_failed"
  | "gateway_error"
  | "service_stopped"
  | "worker_configuration_invalid"
  | "worker_unavailable"
  | "worker_timeout"
  | "worker_response_invalid"
  | "worker_authentication_failed";

export type DiscordSafeError = {
  code: DiscordDiagnosticErrorCode;
  message: string;
};

export type DiscordResourceDiagnostics = {
  status: "ready" | "degraded";
  totalCount: number | null;
  readyCount: number | null;
  missingCount: number | null;
  errorCode: string | null;
};

export type DiscordListingDiagnostics = {
  status: "ready" | "degraded";
  pendingJobs: number | null;
  deadJobs: number | null;
  activeMappings: number | null;
  failedMappings: number | null;
  cooldownClaims: number | null;
  errorCode: string | null;
};

export type DiscordMarketIntelligenceDiagnostics = {
  status: "ready" | "degraded";
  activeCount: number | null;
  pendingCount: number | null;
  deadCount: number | null;
  lastSuccessAt: string | null;
  errorCode: string | null;
};

export type DiscordCommunityNotificationDiagnostics = {
  status: "ready" | "degraded";
  pendingCount: number | null;
  deadCount: number | null;
  suppressedCount: number | null;
  lastDeliveredAt: string | null;
  errorCode: string | null;
};

export type DiscordCommunityCommandDiagnostics = {
  status: "ready" | "degraded";
  registeredCount: number | null;
  definitionHash: string | null;
  lastReconciledAt: string | null;
  errorCode: string | null;
};

export type DiscordDiagnostics = {
  status: "healthy" | "degraded";
  connected: boolean;
  readyState: DiscordReadyState;
  botUsername: string | null;
  guildName: string | null;
  guildId: string | null;
  apiLatencyMs: number | null;
  connectionUptimeMs: number | null;
  error: DiscordSafeError | null;
  resources?: DiscordResourceDiagnostics;
  listings?: DiscordListingDiagnostics;
  marketIntelligence?: DiscordMarketIntelligenceDiagnostics;
  notifications?: DiscordCommunityNotificationDiagnostics;
  commands?: DiscordCommunityCommandDiagnostics;
  requiredPrivilegedIntents?: readonly ["GuildMembers"];
};

export const DISCORD_SAFE_ERROR_MESSAGES: Record<
  DiscordDiagnosticErrorCode,
  string
> = {
  configuration_invalid:
    "Discord service configuration is invalid. Check DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, and DISCORD_GUILD_ID.",
  login_failed: "Discord gateway login failed.",
  privileged_intent_required:
    "Discord Guild Members privileged intent is required for welcome delivery and must be enabled in the Developer Portal.",
  application_mismatch: "The connected Discord bot does not match the configured application.",
  guild_verification_failed: "The configured Discord guild could not be verified.",
  gateway_error: "The Discord gateway reported a connection error.",
  service_stopped: "The Discord service has been stopped.",
  worker_configuration_invalid: "Discord worker diagnostics are not configured.",
  worker_unavailable: "Discord worker diagnostics are unavailable.",
  worker_timeout: "Discord worker diagnostics timed out.",
  worker_response_invalid: "Discord worker returned an invalid diagnostics response.",
  worker_authentication_failed: "Discord worker diagnostics authentication failed.",
};

export function degradedDiscordDiagnostics(
  code: DiscordDiagnosticErrorCode,
): DiscordDiagnostics {
  return {
    status: "degraded",
    connected: false,
    readyState: "error",
    botUsername: null,
    guildName: null,
    guildId: null,
    apiLatencyMs: null,
    connectionUptimeMs: null,
    error: {
      code,
      message: DISCORD_SAFE_ERROR_MESSAGES[code],
    },
    resources: {
      status: "degraded",
      totalCount: null,
      readyCount: null,
      missingCount: null,
      errorCode: code,
    },
    listings: {
      status: "degraded",
      pendingJobs: null,
      deadJobs: null,
      activeMappings: null,
      failedMappings: null,
      cooldownClaims: null,
      errorCode: code,
    },
    marketIntelligence: {
      status: "degraded",
      activeCount: null,
      pendingCount: null,
      deadCount: null,
      lastSuccessAt: null,
      errorCode: code,
    },
    notifications: {
      status: "degraded",
      pendingCount: null,
      deadCount: null,
      suppressedCount: null,
      lastDeliveredAt: null,
      errorCode: code,
    },
    commands: {
      status: "degraded",
      registeredCount: null,
      definitionHash: null,
      lastReconciledAt: null,
      errorCode: code,
    },
    requiredPrivilegedIntents: ["GuildMembers"],
  };
}
