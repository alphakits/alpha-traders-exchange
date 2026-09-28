import "server-only";

import type { EnvironmentValues } from "@/lib/env-validation";

const MINIMUM_HEALTH_SECRET_LENGTH = 32;
const DEFAULT_WORKER_PORT = 3000;

export type DiscordWorkerRuntimeConfig = {
  healthSecret: string;
  port: number;
};

export type DiscordWorkerProxyConfig = {
  baseUrl: string;
  healthSecret: string;
};

export class DiscordWorkerConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Discord worker configuration is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}).`,
    );
    this.name = "DiscordWorkerConfigurationError";
    this.issues = issues;
  }
}

function readHealthSecret(
  env: EnvironmentValues,
  issues: string[],
): string | null {
  const healthSecret = env.DISCORD_WORKER_HEALTH_SECRET?.trim();
  if (!healthSecret) {
    issues.push(
      "Missing required Discord worker environment variable: DISCORD_WORKER_HEALTH_SECRET.",
    );
    return null;
  }
  if (healthSecret.length < MINIMUM_HEALTH_SECRET_LENGTH) {
    issues.push(
      `Invalid Discord worker environment variable: DISCORD_WORKER_HEALTH_SECRET must be at least ${MINIMUM_HEALTH_SECRET_LENGTH} characters.`,
    );
    return null;
  }
  return healthSecret;
}

export function readDiscordWorkerRuntimeConfig(
  env: EnvironmentValues = process.env,
): DiscordWorkerRuntimeConfig {
  const issues: string[] = [];
  const healthSecret = readHealthSecret(env, issues);
  const rawPort = env.PORT?.trim();
  const port = rawPort ? Number(rawPort) : DEFAULT_WORKER_PORT;

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    issues.push(
      "Invalid Discord worker environment variable: PORT must be an integer between 1 and 65535.",
    );
  }
  if (issues.length > 0 || !healthSecret) {
    throw new DiscordWorkerConfigurationError(issues);
  }

  return { healthSecret, port };
}

export function readDiscordWorkerProxyConfig(
  env: EnvironmentValues = process.env,
): DiscordWorkerProxyConfig {
  const issues: string[] = [];
  const healthSecret = readHealthSecret(env, issues);
  const rawBaseUrl = env.DISCORD_WORKER_BASE_URL?.trim();
  let baseUrl: string | null = null;

  if (!rawBaseUrl) {
    issues.push(
      "Missing required Discord worker environment variable: DISCORD_WORKER_BASE_URL.",
    );
  } else {
    try {
      const parsed = new URL(rawBaseUrl);
      const hasUnexpectedComponents =
        parsed.protocol !== "https:"
        || parsed.username !== ""
        || parsed.password !== ""
        || (parsed.pathname !== "" && parsed.pathname !== "/")
        || parsed.search !== ""
        || parsed.hash !== "";

      if (hasUnexpectedComponents) {
        issues.push(
          "Invalid Discord worker environment variable: DISCORD_WORKER_BASE_URL must be an HTTPS origin without credentials, path, query, or fragment.",
        );
      } else {
        baseUrl = parsed.origin;
      }
    } catch {
      issues.push(
        "Invalid Discord worker environment variable: DISCORD_WORKER_BASE_URL must be a valid HTTPS origin.",
      );
    }
  }

  if (issues.length > 0 || !healthSecret || !baseUrl) {
    throw new DiscordWorkerConfigurationError(issues);
  }

  return { baseUrl, healthSecret };
}
