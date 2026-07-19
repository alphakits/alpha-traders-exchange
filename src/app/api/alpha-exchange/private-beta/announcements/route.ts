import { NextResponse } from "next/server";
import { getActiveBetaAnnouncements } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const announcements = await getActiveBetaAnnouncements();
  return NextResponse.json({ announcements });
}
