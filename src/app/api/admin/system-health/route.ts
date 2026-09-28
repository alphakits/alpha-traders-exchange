import { NextResponse } from "next/server";

import { requireApiAdmin } from "@/lib/api-auth";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import {
  buildMarketplaceOperationalSnapshot,
  type MarketplaceOperationalSnapshot,
} from "@/lib/marketplace-operational-health";
import { logEvent } from "@/lib/structured-logging";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HealthState = "healthy" | "degraded";

type HealthCheck = {
  key: "application" | "database" | "authentication" | "trade_room" | "notifications" | "email" | "marketplace_operations";
  label: string;
  status: HealthState;
  detail: string;
  latencyMs?: number;
};

const DATABASE_TIMEOUT_MS = 4_000;

function hasEnvironmentValues(keys: string[]) {
  return keys.every((key) => Boolean(process.env[key]?.trim()));
}

async function checkDatabase(): Promise<HealthCheck> {
  const startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const repository = await getAlphaExchangeRepository();
    await Promise.race([
      repository.healthCheck(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("database_health_timeout")), DATABASE_TIMEOUT_MS);
      }),
    ]);
    return {
      key: "database",
      label: "Database",
      status: "healthy",
      detail: "The marketplace database accepted a live query.",
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    logEvent("error", {
      event: "system_health_database_check",
      outcome: "failed",
      reason: "database_unavailable",
      metadata: { errorName: error instanceof Error ? error.name : typeof error },
    });
    return {
      key: "database",
      label: "Database",
      status: "degraded",
      detail: "The marketplace database did not complete its health check.",
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function checkMarketplaceOperations(): Promise<{
  check: HealthCheck;
  snapshot: MarketplaceOperationalSnapshot | null;
}> {
  const startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const repository = await getAlphaExchangeRepository();
    const operationalData = await Promise.race([
      repository.loadOperationalHealthData(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("marketplace_operations_timeout")), DATABASE_TIMEOUT_MS);
      }),
    ]);
    const snapshot = buildMarketplaceOperationalSnapshot(operationalData);
    const status = snapshot.status === "healthy" ? "healthy" : "degraded";
    const detail = snapshot.status === "healthy"
      ? "No stuck trades, stale offers, overdue releases, or listing-lock inconsistencies were detected."
      : `${snapshot.incidents.length} marketplace item${snapshot.incidents.length === 1 ? " requires" : "s require"} owner attention.`;
    return {
      check: {
        key: "marketplace_operations",
        label: "Marketplace operations",
        status,
        detail,
        latencyMs: Date.now() - startedAt,
      },
      snapshot,
    };
  } catch (error) {
    logEvent("error", {
      event: "system_health_marketplace_operations",
      outcome: "failed",
      reason: "operational_snapshot_unavailable",
      metadata: { errorName: error instanceof Error ? error.name : typeof error },
    });
    return {
      check: {
        key: "marketplace_operations",
        label: "Marketplace operations",
        status: "degraded",
        detail: "Operational trade and listing checks could not be completed.",
        latencyMs: Date.now() - startedAt,
      },
      snapshot: null,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function GET() {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  const startedAt = Date.now();
  const [database, marketplaceOperations] = await Promise.all([
    checkDatabase(),
    checkMarketplaceOperations(),
  ]);
  const authConfigured = hasEnvironmentValues([
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);
  const emailConfigured = hasEnvironmentValues(["RESEND_API_KEY", "EMAIL_FROM"]);
  const databaseReady = database.status === "healthy";

  const checks: HealthCheck[] = [
    {
      key: "application",
      label: "Website application",
      status: "healthy",
      detail: "The protected health endpoint is responding.",
    },
    database,
    {
      key: "authentication",
      label: "Authentication",
      status: authConfigured ? "healthy" : "degraded",
      detail: authConfigured
        ? "Supabase authentication configuration is present."
        : "One or more required Supabase authentication settings are missing.",
    },
    {
      key: "trade_room",
      label: "Trade Room live updates",
      status: databaseReady ? "healthy" : "degraded",
      detail: databaseReady
        ? "Chat and live-update reconciliation dependencies are available."
        : "Trade Room reconciliation is waiting for database recovery.",
    },
    {
      key: "notifications",
      label: "In-app notifications",
      status: databaseReady ? "healthy" : "degraded",
      detail: databaseReady
        ? "Durable in-app notification storage is available."
        : "Durable in-app notifications are waiting for database recovery.",
    },
    {
      key: "email",
      label: "Transactional email",
      status: emailConfigured ? "healthy" : "degraded",
      detail: emailConfigured
        ? "The transactional email provider is configured."
        : "The transactional email provider is not fully configured.",
    },
    marketplaceOperations.check,
  ];
  const status: HealthState = checks.every((check) => check.status === "healthy") ? "healthy" : "degraded";
  const release = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "local").slice(0, 12);

  return NextResponse.json(
    {
      status,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      release,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      checks,
      operations: marketplaceOperations.snapshot,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
