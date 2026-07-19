import { NextResponse } from "next/server";
import { getAllSellerApplicationsForAdmin, getPendingSellerApplicationsForAdmin } from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";

export async function GET() {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  const [applications, pendingApplications] = await Promise.all([getAllSellerApplicationsForAdmin(), getPendingSellerApplicationsForAdmin()]);
  return NextResponse.json({ applications, pendingApplications });
}
