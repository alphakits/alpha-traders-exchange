import { NextResponse } from "next/server";

import { requireApiAdmin } from "@/lib/api-auth";
import { getDiscordService } from "@/lib/discord";
import { DiscordServiceError } from "@/lib/discord/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  const service = getDiscordService();
  try {
    const diagnostics = await service.start();
    return NextResponse.json(
      diagnostics,
      { status: diagnostics.status === "healthy" ? 200 : 503 },
    );
  } catch (error) {
    if (error instanceof DiscordServiceError) {
      return NextResponse.json(service.getDiagnostics(), { status: 503 });
    }
    throw error;
  }
}
