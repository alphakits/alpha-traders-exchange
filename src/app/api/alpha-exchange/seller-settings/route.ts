import { NextRequest, NextResponse } from "next/server";
import { requireApiSellerWorkspaceActor } from "@/lib/api-auth";
import {
  addSellerBankAccount,
  deleteSellerBankAccount,
  getSellerBankAccountsForUser,
  updateSellerAvailabilityStatus,
  updateSellerBankAccount,
  updateUserSellerSettings,
} from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import type { SellerAvailabilityStatus, SupportedNetwork } from "@/types/alpha-exchange";

export async function GET() {
  const { user, unauthorized } = await requireApiSellerWorkspaceActor();
  if (!user) return unauthorized;
  const bankAccounts = await getSellerBankAccountsForUser(user.id);

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
      availabilityStatus: user.availabilityStatus,
    },
    bankAccounts,
  });
}

export async function PATCH(request: NextRequest) {
  const { user, unauthorized } = await requireApiSellerWorkspaceActor();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({ headers: request.headers, key: "exchange:seller-settings", maxRequests: 20, windowMs: 60_000 });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many settings update requests. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  try {
    const body = await request.json();
    const action = typeof body.action === "string" ? body.action.trim() : "";

    if (action === "add_bank_account") {
      const account = await addSellerBankAccount({
        sellerId: user.id,
        actorUserId: user.id,
        accountHolderName: String(body.accountHolderName ?? ""),
        bankName: String(body.bankName ?? ""),
        branchNumber: String(body.branchNumber ?? ""),
        accountNumber: String(body.accountNumber ?? ""),
        isDefault: body.isDefault === true,
      });
      return NextResponse.json({ bankAccount: account, bankAccounts: await getSellerBankAccountsForUser(user.id) });
    }

    if (action === "update_bank_account") {
      const bankAccountId = String(body.bankAccountId ?? "").trim();
      if (!bankAccountId) {
        return NextResponse.json({ error: "bankAccountId is required." }, { status: 400 });
      }
      const account = await updateSellerBankAccount({
        sellerId: user.id,
        actorUserId: user.id,
        bankAccountId,
        accountHolderName: String(body.accountHolderName ?? ""),
        bankName: String(body.bankName ?? ""),
        branchNumber: String(body.branchNumber ?? ""),
        accountNumber: String(body.accountNumber ?? ""),
        isDefault: body.isDefault === true,
      });
      return NextResponse.json({ bankAccount: account, bankAccounts: await getSellerBankAccountsForUser(user.id) });
    }

    if (action === "delete_bank_account") {
      const bankAccountId = String(body.bankAccountId ?? "").trim();
      if (!bankAccountId) {
        return NextResponse.json({ error: "bankAccountId is required." }, { status: 400 });
      }
      await deleteSellerBankAccount({ sellerId: user.id, actorUserId: user.id, bankAccountId });
      return NextResponse.json({ ok: true, bankAccounts: await getSellerBankAccountsForUser(user.id) });
    }

    const fullName = body.fullName ? String(body.fullName).slice(0, 100) : undefined;
    const whatsappNumber = body.whatsappNumber ? String(body.whatsappNumber).slice(0, 30) : undefined;
    const profilePhotoUrl = body.profilePhotoUrl !== undefined ? String(body.profilePhotoUrl).slice(0, 500) : undefined;
    const coverBannerUrl = body.coverBannerUrl !== undefined ? String(body.coverBannerUrl).slice(0, 500) : undefined;
    const bio = body.bio !== undefined ? String(body.bio).slice(0, 2000) : undefined;
    const tradingExperience = body.tradingExperience !== undefined ? String(body.tradingExperience).slice(0, 1000) : undefined;
    const workingHours = body.workingHours !== undefined ? String(body.workingHours).slice(0, 200) : undefined;
    const country = body.country !== undefined ? String(body.country).slice(0, 100) : undefined;
    const city = body.city !== undefined ? String(body.city).slice(0, 100) : undefined;
    const onlineStatus = body.onlineStatus === "online" || body.onlineStatus === "offline" ? body.onlineStatus : undefined;
    const availabilityStatus = body.availabilityStatus === "available" || body.availabilityStatus === "away" || body.availabilityStatus === "vacation"
      ? body.availabilityStatus as SellerAvailabilityStatus
      : undefined;
    const preferredNetworksInput = Array.isArray(body.preferredNetworks) ? body.preferredNetworks.map((value: unknown) => String(value)) : undefined;
    const preferredPaymentMethods = Array.isArray(body.preferredPaymentMethods) ? body.preferredPaymentMethods.map((value: unknown) => String(value).trim()).filter(Boolean).slice(0, 8) : undefined;
    const languagesInput = Array.isArray(body.languages) ? body.languages.map((value: unknown) => String(value).trim()).filter(Boolean) : undefined;
    const preferredNetworks = preferredNetworksInput
      ? (preferredNetworksInput.filter((network: string) => network === "TRC20" || network === "ERC20" || network === "BEP20" || network === "SOL") as SupportedNetwork[])
      : undefined;
    const hasProfileUpdates = Boolean(
      fullName !== undefined ||
      whatsappNumber !== undefined ||
      preferredNetworks !== undefined ||
      profilePhotoUrl !== undefined ||
      coverBannerUrl !== undefined ||
      languagesInput !== undefined ||
      bio !== undefined ||
      tradingExperience !== undefined ||
      workingHours !== undefined ||
      preferredPaymentMethods !== undefined ||
      country !== undefined ||
      city !== undefined ||
      onlineStatus !== undefined,
    );

    const currentPassword = body.currentPassword ? String(body.currentPassword) : "";
    const newPassword = body.newPassword ? String(body.newPassword) : "";
    let requestedPasswordChange = false;
    if (currentPassword || newPassword) {
      if (!currentPassword || !newPassword) {
        return NextResponse.json({ error: "Both current and new password are required." }, { status: 400 });
      }
      if (newPassword.length < 8) {
        return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
      }
      requestedPasswordChange = true;
    }

    const updatedUser = hasProfileUpdates
      ? await updateUserSellerSettings({
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
        })
      : user;

    const sellerWithAvailability = availabilityStatus
      ? await updateSellerAvailabilityStatus({ sellerId: user.id, actorUserId: user.id, availabilityStatus })
      : updatedUser;

    if (requestedPasswordChange) {
      return NextResponse.json({ error: "Use the password reset flow from login to change your password." }, { status: 400 });
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
        country: sellerWithAvailability.country ?? "",
        city: sellerWithAvailability.city ?? "",
        onlineStatus: sellerWithAvailability.onlineStatus,
        availabilityStatus: sellerWithAvailability.availabilityStatus,
      },
      bankAccounts: await getSellerBankAccountsForUser(user.id),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update seller settings." }, { status: 400 });
  }
}
