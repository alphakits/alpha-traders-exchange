import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { activateBuyerOnboardingWithoutPhone } from "@/lib/alpha-exchange-store";
import { isMarketplacePhoneVerificationEnabled } from "@/lib/phone-verification";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  if (isMarketplacePhoneVerificationEnabled()) {
    return NextResponse.json({ error: "Phone verification is active. Please use the OTP verification flow." }, { status: 409 });
  }
  const rate = await checkSharedRateLimit({ headers: request.headers, key: "auth:onboarding-buyer-activate", maxRequests: 10, windowMs: 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);

  const body = await request.json();
  const updated = await activateBuyerOnboardingWithoutPhone({
    userId: user.id,
    firstName: String(body?.firstName ?? ""),
    lastName: String(body?.lastName ?? ""),
    displayName: String(body?.displayName ?? ""),
  });

  return NextResponse.json({
    ok: true,
    user: {
      id: updated.id,
      role: updated.role,
      roles: updated.roles ?? [updated.role],
      onboardingSelection: updated.onboardingSelection,
      onboardingCompletedAt: updated.onboardingCompletedAt,
    },
  });
}
