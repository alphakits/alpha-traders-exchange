import { NextResponse } from "next/server";
import { checkRuntimeDatabaseHealth } from "@/lib/database-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startTime = Date.now();

export async function GET() {
  const database = await checkRuntimeDatabaseHealth();
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  const status = database.status === "ok" ? 200 : 503;

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
      },
    },
  );
}
