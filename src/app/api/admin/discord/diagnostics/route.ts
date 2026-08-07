import { NextResponse } from "next/server";

import { requireApiAdmin } from "@/lib/api-auth";
import { fetchDiscordWorkerDiagnostics } from "@/lib/discord/worker-health-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  const diagnostics = await fetchDiscordWorkerDiagnostics();
  return NextResponse.json(
    diagnostics,
    { status: diagnostics.status === "healthy" ? 200 : 503 },
  );
}
