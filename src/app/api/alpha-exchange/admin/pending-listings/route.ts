import { NextResponse } from "next/server";
import { getOwnerPendingListingsDashboardData } from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";

export async function GET() {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  return NextResponse.json(await getOwnerPendingListingsDashboardData());
}
