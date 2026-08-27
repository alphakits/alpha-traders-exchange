import { NextRequest, NextResponse } from "next/server";
import { getActiveBetaAnnouncements } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";
import { normalizePreferredLocale } from "@/lib/preferred-locale";

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const requestedLocale = request.nextUrl.searchParams.get("locale");
  const locale = requestedLocale === "ar" || requestedLocale === "en"
    ? requestedLocale
    : normalizePreferredLocale(user.preferredLocale);
  const announcements = await getActiveBetaAnnouncements(locale);
  return NextResponse.json({ announcements });
}
