import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME, clearUserSession, getCurrentSessionToken, getCurrentSessionUser } from "@/lib/auth";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  const user = await getCurrentSessionUser();
  if (!user) {
    const token = await getCurrentSessionToken();
    await clearUserSession(token);
    const cookieStore = await cookies();
    cookieStore.delete(AUTH_COOKIE_NAME);
    cookieStore.delete(AUTH_VERIFIED_COOKIE_NAME);
    return NextResponse.json({ user: null }, { status: 200, headers: AUTH_RESPONSE_HEADERS });
  }
  return NextResponse.json({
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      sellerStatus: user.sellerStatus,
      whatsappNumber: user.whatsappNumber,
      preferredNetworks: user.preferredNetworks,
      profilePhotoUrl: user.profilePhotoUrl,
      coverBannerUrl: user.coverBannerUrl ?? "",
      languages: user.languages,
      bio: user.bio,
      tradingExperience: user.tradingExperience ?? "",
      workingHours: user.workingHours ?? "",
      preferredPaymentMethods: user.preferredPaymentMethods ?? [],
      country: user.country ?? "",
      city: user.city ?? "",
      onlineStatus: user.onlineStatus,
      availabilityStatus: user.availabilityStatus,
      lastActiveAt: user.lastActiveAt ?? user.updatedAt,
      isFeaturedSeller: user.isFeaturedSeller === true,
      isProfileHidden: user.isProfileHidden === true,
      isFoundingMember: user.isFoundingMember === true,
      isFoundingSeller: user.isFoundingSeller === true,
      emailVerified: user.emailVerified === true,
      notificationPreferences: user.notificationPreferences ?? { inApp: true, email: false, sms: false },
      createdAt: user.createdAt,
    },
  }, { headers: AUTH_RESPONSE_HEADERS });
}
