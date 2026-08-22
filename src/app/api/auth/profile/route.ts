import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { getAccountProfileData, updateAccountProfileData } from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit } from "@/lib/rate-limit";

type RoleBadgeVariant = "guest" | "student" | "buyer" | "pending_seller" | "approved_seller" | "administrator" | "owner";

function toRoleBadgeVariant(user: { role: string; roles?: string[]; sellerStatus: string }): RoleBadgeVariant {
  const roles = user.roles ?? [];
  if (roles.includes("owner") || user.role === "owner") return "owner";
  if (roles.includes("admin") || user.role === "admin") return "administrator";
  if (roles.includes("approved_seller") || user.role === "approved_seller" || user.sellerStatus === "approved_seller") return "approved_seller";
  if (roles.includes("pending_seller_approval") || user.sellerStatus === "pending_seller_approval") return "pending_seller";
  if (roles.includes("buyer") || user.role === "buyer") return "buyer";
  if (roles.includes("student") || user.role === "student") return "student";
  if (roles.includes("guest") || user.role === "guest") return "guest";
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

function roleLabelFor(variant: RoleBadgeVariant): "Guest" | "Student" | "Buyer" | "Pending Seller" | "Approved Seller" | "Administrator" | "Owner" {
  if (variant === "owner") return "Owner";
  if (variant === "administrator") return "Administrator";
  if (variant === "pending_seller") return "Pending Seller";
  if (variant === "approved_seller") return "Approved Seller";
  if (variant === "student") return "Student";
  if (variant === "guest") return "Guest";
  if (variant === "buyer") return "Buyer";
  return "Guest";
}

export async function GET() {
  const routeStartedAt = Date.now();
  const timeline: Array<{ name: string; startTime: number; endTime: number; durationMs: number }> = [];
  const authStartedAt = Date.now();
  const { user, unauthorized } = await requireApiUser();
  const authEndedAt = Date.now();
  timeline.push({
    name: "/api/auth/profile:auth",
    startTime: authStartedAt,
    endTime: authEndedAt,
    durationMs: Math.max(0, authEndedAt - authStartedAt),
  });
  if (!user) return unauthorized;

  const profileLoadStartedAt = Date.now();
  const payload = await getAccountProfileData(user.id);
  const profileLoadEndedAt = Date.now();
  timeline.push({
    name: "/api/auth/profile:data",
    startTime: profileLoadStartedAt,
    endTime: profileLoadEndedAt,
    durationMs: Math.max(0, profileLoadEndedAt - profileLoadStartedAt),
  });
  const roleBadge = toRoleBadgeVariant(user);
  const routeMs = Date.now() - routeStartedAt;
  return NextResponse.json({
    profile: {
      ...payload.profile,
      roles: user.roles ?? [user.role],
      onboardingSelection: user.onboardingSelection,
      onboardingCompletedAt: user.onboardingCompletedAt,
    },
    stats: payload.stats,
    roleBadge,
    roleLabel: roleLabelFor(roleBadge),
    accountStatuses: accountStatuses(user),
  }, {
    headers: {
      "X-Auth-Profile-Route-Ms": String(routeMs),
      "X-Auth-Profile-Timeline": JSON.stringify(timeline),
      "Server-Timing": `route;dur=${routeMs}, auth;dur=${Math.max(0, authEndedAt - authStartedAt)}, profile;dur=${Math.max(0, profileLoadEndedAt - profileLoadStartedAt)}`,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const routeStartedAt = Date.now();
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({ headers: request.headers, key: "auth:profile-update", maxRequests: 20, windowMs: 60_000 });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many profile update requests. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  try {
    const validationStartedAt = Date.now();
    const body = await request.json();
    const fullName = body.fullName !== undefined ? String(body.fullName).trim().slice(0, 100) : undefined;
    const profilePhotoUrl = body.profilePhotoUrl !== undefined ? String(body.profilePhotoUrl).trim().slice(0, 500) : undefined;
    const coverBannerUrl = body.coverBannerUrl !== undefined ? String(body.coverBannerUrl).trim().slice(0, 500) : undefined;
    const bio = body.bio !== undefined ? String(body.bio).slice(0, 2000) : undefined;
    const country = body.country !== undefined ? String(body.country).trim().slice(0, 100) : undefined;
    const language = body.language !== undefined ? String(body.language).trim().slice(0, 20) : undefined;
    const whatsappNumber = body.whatsappNumber !== undefined ? String(body.whatsappNumber).trim().slice(0, 30) : undefined;
    const isProfileHidden = typeof body.isProfileHidden === "boolean" ? body.isProfileHidden : undefined;
    const showTradeStats = typeof body.showTradeStats === "boolean" ? body.showTradeStats : undefined;
    const showLastActive = typeof body.showLastActive === "boolean" ? body.showLastActive : undefined;
    const allowDirectMessages = typeof body.allowDirectMessages === "boolean" ? body.allowDirectMessages : undefined;
    const allowProfileSearch = typeof body.allowProfileSearch === "boolean" ? body.allowProfileSearch : undefined;
    const showPhonePublic = typeof body.showPhonePublic === "boolean" ? body.showPhonePublic : undefined;
    const showEmailPublic = typeof body.showEmailPublic === "boolean" ? body.showEmailPublic : undefined;

    if (fullName !== undefined && !fullName) {
      return NextResponse.json({ error: "Full name is required." }, { status: 400 });
    }
    const validationMs = Date.now() - validationStartedAt;

    const logicStartedAt = Date.now();
    await updateAccountProfileData({
      userId: user.id,
      profilePhotoUrl,
      coverBannerUrl,
      fullName,
      bio,
      country,
      language,
      whatsappNumber,
      isProfileHidden,
      showTradeStats,
      showLastActive,
      allowDirectMessages,
      allowProfileSearch,
      showPhonePublic,
      showEmailPublic,
    });

    const payload = await getAccountProfileData(user.id);
    const roleBadge = toRoleBadgeVariant(user);
    const logicMs = Date.now() - logicStartedAt;
    const routeMs = Date.now() - routeStartedAt;
    return NextResponse.json({
      profile: {
        ...payload.profile,
        roles: user.roles ?? [user.role],
        onboardingSelection: user.onboardingSelection,
        onboardingCompletedAt: user.onboardingCompletedAt,
      },
      stats: payload.stats,
      roleBadge,
      roleLabel: roleLabelFor(roleBadge),
      accountStatuses: accountStatuses(user),
    }, {
      headers: {
        "X-Trade-Route-Ms": String(routeMs),
        "X-Trade-Validation-Ms": String(validationMs),
        "X-Trade-Logic-Ms": String(logicMs),
        "Server-Timing": `route;dur=${routeMs}, validate;dur=${validationMs}, logic;dur=${logicMs}`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update profile." }, { status: 400 });
  }
}
