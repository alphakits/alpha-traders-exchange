import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { getSmsDeliveriesForAdmin } from "@/lib/alpha-exchange-store";
import { hasRole } from "@/lib/roles";

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  if (!hasRole(user, "admin") && !hasRole(user, "owner")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ deliveries: await getSmsDeliveriesForAdmin() });
}
