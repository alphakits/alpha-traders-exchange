import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, AUTH_PHONE_VERIFIED_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME, clearUserSession, getCurrentSessionToken, getCurrentSessionUser } from "@/lib/auth";
import { isPhotoVerificationBypassed, isVerified } from "@/lib/verification-bypass";

const AUTH_RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  const user = await getCurrentSessionUser();
  if (!user) {
    const token = await getCurrentSessionToken();
    await clearUserSession(token);
    const cookieStore = await cookies();
    cookieStore.delete(AUTH_COOKIE_NAME);
    cookieStore.delete(AUTH_VERIFIED_COOKIE_NAME);
    cookieStore.delete(AUTH_PHONE_VERIFIED_COOKIE_NAME);
    return NextResponse.json({ user: null }, { status: 200, headers: AUTH_RESPONSE_HEADERS });
  }
  const cookieStore = await cookies();
  const verificationBypassed = isPhotoVerificationBypassed(user.email);
  const verified = process.env.ALPHA_EXCHANGE_SKIP_PHONE_VERIFICATION === "1" || isVerified(user);
  const effectiveVerifiedPhone = verificationBypassed ? user.verifiedPhone || "bypassed" : user.verifiedPhone ?? "";
  const effectivePhoneVerifiedAt = verificationBypassed ? user.phoneVerifiedAt || new Date(0).toISOString() : user.phoneVerifiedAt ?? "";
  if (verified) {
    cookieStore.set(AUTH_PHONE_VERIFIED_COOKIE_NAME, "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
  }
  return NextResponse.json({
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      roles: user.roles ?? [user.role],
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
      isPhotoVerified: verified,
      verifiedPhone: effectiveVerifiedPhone,
      phoneVerifiedAt: effectivePhoneVerifiedAt,
      onboardingSelection: user.onboardingSelection,
      onboardingCompletedAt: user.onboardingCompletedAt,
      lifetimeCompletedVolumeUsdt: user.lifetimeCompletedVolumeUsdt ?? 0,
      sellerPrestigeRank: user.sellerPrestigeRank ?? "bronze",
      sellerRankOverride: user.sellerRankOverride,
      sellerPromotionHistory: user.sellerPromotionHistory ?? [],
      notificationPreferences: user.notificationPreferences ?? { inApp: true, email: false, sms: false },
      createdAt: user.createdAt,
    },
  }, { headers: AUTH_RESPONSE_HEADERS });
}
