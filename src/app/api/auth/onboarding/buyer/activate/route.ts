import { NextRequest, NextResponse } from "next/server";
import { requireApiUser, requireEmailVerificationForTrading } from "@/lib/api-auth";
import { activateBuyerOnboardingWithoutPhone } from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const emailVerificationRequired = requireEmailVerificationForTrading(user);
  if (emailVerificationRequired) return emailVerificationRequired;
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
