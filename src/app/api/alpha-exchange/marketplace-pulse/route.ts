import { NextResponse } from "next/server";
import { getMarketplacePulse } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// Read-only pulse. Foreground interaction tracking owns user activity.
export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  const pulse = await getMarketplacePulse();

  return NextResponse.json(pulse, { headers: { "Cache-Control": "no-store" } });
}
