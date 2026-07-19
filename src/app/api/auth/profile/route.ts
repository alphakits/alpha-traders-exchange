import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";
import { getAccountProfileData, updateAccountProfileData } from "@/lib/alpha-exchange-store";

type RoleBadgeVariant = "member" | "buyer" | "approved_seller" | "moderator" | "administrator" | "owner";

function toRoleBadgeVariant(user: { role: string; email: string; sellerStatus: string }): RoleBadgeVariant {
  if (user.role === "admin" && isAlphaExchangeOwnerEmail(user.email)) return "owner";
  if (user.role === "admin") return "administrator";
  if (user.role === "approved_seller" || user.sellerStatus === "approved_seller") return "approved_seller";
  return "buyer";
}

function accountStatuses(user: { sellerStatus: string }) {
  const statuses: string[] = [];
  if (user.sellerStatus === "suspended") {
    statuses.push("Suspended");
    return statuses;
  }
  statuses.push("Active");
  if (user.sellerStatus === "pending_seller_approval") statuses.push("Pending Seller Approval");
  return statuses;
}

function roleLabelFor(variant: RoleBadgeVariant): "Member" | "Buyer" | "Approved Seller" | "Moderator" | "Administrator" | "Owner" {
  if (variant === "owner") return "Owner";
  if (variant === "administrator") return "Administrator";
  if (variant === "moderator") return "Moderator";
  if (variant === "approved_seller") return "Approved Seller";
  if (variant === "buyer") return "Buyer";
  return "Member";
}

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  const payload = await getAccountProfileData(user.id);
  const roleBadge = toRoleBadgeVariant(user);
  return NextResponse.json({
    profile: payload.profile,
    stats: payload.stats,
    roleBadge,
    roleLabel: roleLabelFor(roleBadge),
    accountStatuses: accountStatuses(user),
  });
}

export async function PATCH(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  try {
    const body = await request.json();
    const fullName = body.fullName !== undefined ? String(body.fullName).trim() : undefined;
    const profilePhotoUrl = body.profilePhotoUrl !== undefined ? String(body.profilePhotoUrl).trim() : undefined;
    const bio = body.bio !== undefined ? String(body.bio) : undefined;
    const country = body.country !== undefined ? String(body.country).trim() : undefined;
    const language = body.language !== undefined ? String(body.language).trim() : undefined;
    const whatsappNumber = body.whatsappNumber !== undefined ? String(body.whatsappNumber).trim() : undefined;

    if (fullName !== undefined && !fullName) {
      return NextResponse.json({ error: "Full name is required." }, { status: 400 });
    }

    await updateAccountProfileData({
      userId: user.id,
      profilePhotoUrl,
      fullName,
      bio,
      country,
      language,
      whatsappNumber,
    });

    const payload = await getAccountProfileData(user.id);
    const roleBadge = toRoleBadgeVariant(user);
    return NextResponse.json({
      profile: payload.profile,
      stats: payload.stats,
      roleBadge,
      roleLabel: roleLabelFor(roleBadge),
      accountStatuses: accountStatuses(user),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update profile." }, { status: 400 });
  }
}
