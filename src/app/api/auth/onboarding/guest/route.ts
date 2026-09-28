import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { selectGuestOnboarding } from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({ headers: request.headers, key: "auth:onboarding-guest", maxRequests: 10, windowMs: 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);
  const updated = await selectGuestOnboarding(user.id);
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
