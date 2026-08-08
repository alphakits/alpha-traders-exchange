import { type NextRequest, NextResponse } from "next/server";

import { requireApiAdmin } from "@/lib/api-auth";
import {
  buildDiscordManagementDiagnostics,
  readDiscordManagementDatabaseDiagnostics,
} from "@/lib/discord/management";
import { fetchDiscordWorkerDiagnostics } from "@/lib/discord/worker-health-client";
import {
  checkRateLimit,
  createRateLimitResponse,
} from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  const rate = checkRateLimit({
    headers: request.headers,
    key: "admin:discord-diagnostics",
    identifier: user.id,
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);

  try {
    const [worker, database] = await Promise.all([
      fetchDiscordWorkerDiagnostics(),
      readDiscordManagementDatabaseDiagnostics(),
    ]);
    const diagnostics = buildDiscordManagementDiagnostics({ worker, database });
    return NextResponse.json(diagnostics, {
      status: diagnostics.status === "healthy" ? 200 : 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    logEvent("error", {
      event: "discord_management_diagnostics",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "failed",
      reason: "database_diagnostics_failed",
      metadata: {
        errorType: error instanceof Error ? error.name : typeof error,
      },
    });
    return NextResponse.json(
      {
        error: "Discord management diagnostics are unavailable.",
        code: "database_diagnostics_failed",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  }
}
