import { NextResponse } from "next/server";
import { getAllSellerApplicationsForAdmin, getPendingSellerApplicationsForAdmin } from "@/lib/alpha-exchange-store";
import { requireApiOwner } from "@/lib/api-auth";

export async function GET() {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) return unauthorized;

  const [applications, pendingApplications] = await Promise.all([getAllSellerApplicationsForAdmin(), getPendingSellerApplicationsForAdmin()]);
  return NextResponse.json({ applications, pendingApplications }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
