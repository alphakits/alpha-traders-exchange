import { NextRequest, NextResponse } from "next/server";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { requireApiUser } from "@/lib/api-auth";
import { updateUserPassword, updateUserSellerSettings } from "@/lib/alpha-exchange-store";
import type { SupportedNetwork } from "@/types/alpha-exchange";

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  return NextResponse.json({
    profile: {
      fullName: user.fullName,
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
    },
  });
}

export async function PATCH(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  try {
    const body = await request.json();

    const fullName = body.fullName ? String(body.fullName) : undefined;
    const whatsappNumber = body.whatsappNumber ? String(body.whatsappNumber) : undefined;
    const profilePhotoUrl = body.profilePhotoUrl !== undefined ? String(body.profilePhotoUrl) : undefined;
    const coverBannerUrl = body.coverBannerUrl !== undefined ? String(body.coverBannerUrl) : undefined;
    const bio = body.bio !== undefined ? String(body.bio) : undefined;
    const tradingExperience = body.tradingExperience !== undefined ? String(body.tradingExperience) : undefined;
    const workingHours = body.workingHours !== undefined ? String(body.workingHours) : undefined;
    const country = body.country !== undefined ? String(body.country) : undefined;
    const city = body.city !== undefined ? String(body.city) : undefined;
    const onlineStatus = body.onlineStatus === "online" || body.onlineStatus === "offline" ? body.onlineStatus : undefined;
    const preferredNetworksInput = Array.isArray(body.preferredNetworks) ? body.preferredNetworks.map((value: unknown) => String(value)) : undefined;
    const preferredPaymentMethods = Array.isArray(body.preferredPaymentMethods) ? body.preferredPaymentMethods.map((value: unknown) => String(value).trim()).filter(Boolean).slice(0, 8) : undefined;
    const languagesInput = Array.isArray(body.languages) ? body.languages.map((value: unknown) => String(value).trim()).filter(Boolean) : undefined;
    const preferredNetworks = preferredNetworksInput
      ? (preferredNetworksInput.filter((network: string) => network === "TRC20" || network === "ERC20" || network === "BEP20" || network === "SOL") as SupportedNetwork[])
      : undefined;

    const updatedUser = await updateUserSellerSettings({
      userId: user.id,
      fullName,
      whatsappNumber,
      preferredNetworks,
      profilePhotoUrl,
      coverBannerUrl,
      languages: languagesInput,
      bio,
      tradingExperience,
      workingHours,
      preferredPaymentMethods,
      country,
      city,
      onlineStatus,
    });

    const currentPassword = body.currentPassword ? String(body.currentPassword) : "";
    const newPassword = body.newPassword ? String(body.newPassword) : "";
    if (currentPassword || newPassword) {
      if (!currentPassword || !newPassword) {
        return NextResponse.json({ error: "Both current and new password are required." }, { status: 400 });
      }
      const isValid = await verifyPassword(currentPassword, user.passwordHash);
      if (!isValid) {
        return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
      }
      if (newPassword.length < 8) {
        return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
      }
      const passwordHash = await hashPassword(newPassword);
      await updateUserPassword(user.id, passwordHash);
    }

    return NextResponse.json({
      profile: {
        fullName: updatedUser.fullName,
        whatsappNumber: updatedUser.whatsappNumber,
        preferredNetworks: updatedUser.preferredNetworks,
        profilePhotoUrl: updatedUser.profilePhotoUrl,
        coverBannerUrl: updatedUser.coverBannerUrl ?? "",
        languages: updatedUser.languages,
        bio: updatedUser.bio,
        tradingExperience: updatedUser.tradingExperience ?? "",
        workingHours: updatedUser.workingHours ?? "",
        preferredPaymentMethods: updatedUser.preferredPaymentMethods ?? [],
        country: updatedUser.country ?? "",
        city: updatedUser.city ?? "",
        onlineStatus: updatedUser.onlineStatus,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update seller settings." }, { status: 400 });
  }
}
