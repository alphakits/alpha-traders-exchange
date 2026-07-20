import { NextResponse } from "next/server";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";

const startTime = Date.now();

export async function GET() {
  let dbStatus: "ok" | "error" = "ok";
  try {
    const repository = await getAlphaExchangeRepository();
    await repository.healthCheck();
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
