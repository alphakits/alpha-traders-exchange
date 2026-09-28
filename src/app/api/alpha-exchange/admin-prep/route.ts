import { NextResponse } from "next/server";
import {
  getAdminPrepDashboardData,
} from "@/lib/alpha-exchange-store";
import { requireApiOwner } from "@/lib/api-auth";

export async function GET() {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) return unauthorized;

  return NextResponse.json(await getAdminPrepDashboardData(user.id), { headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" } });
}
