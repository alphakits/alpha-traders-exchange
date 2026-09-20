import { NextResponse } from "next/server";
import { checkRuntimeDatabaseHealth } from "@/lib/database-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startTime = Date.now();

export async function GET() {
  const routeStartedAt = Date.now();
  const database = await checkRuntimeDatabaseHealth();
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const status = database.status === "ok" ? 200 : 503;
  const routeDurationMs = Date.now() - routeStartedAt;

  return NextResponse.json(
    {
      status: database.status === "ok" ? "ok" : "degraded",
      uptime: uptimeSeconds,
      checks: {
        database: database.status,
      },
      responseTimeMs: database.durationMs,
      timestamp: new Date().toISOString(),
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Server-Timing": `health;dur=${routeDurationMs}, db;dur=${database.durationMs}`,
        "X-Health-Route-Ms": String(routeDurationMs),
      },
    },
  );
}
