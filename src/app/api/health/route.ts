import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const startTime = Date.now();

export async function GET() {
  const dbPath = path.join(process.cwd(), "data", "alpha-exchange-db.json");

  let dbStatus: "ok" | "error" = "ok";
  try {
    await fs.access(dbPath);
  } catch {
    dbStatus = "error";
  }

  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  const status = dbStatus === "ok" ? 200 : 503;

  return NextResponse.json(
    {
      status: dbStatus === "ok" ? "ok" : "degraded",
      uptime: uptimeSeconds,
      checks: {
        database: dbStatus,
      },
      timestamp: new Date().toISOString(),
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
