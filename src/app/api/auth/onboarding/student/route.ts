import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { grantStudentRole } from "@/lib/alpha-exchange-store";
import { checkRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = checkRateLimit({ headers: request.headers, key: "auth:onboarding-student", maxRequests: 10, windowMs: 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);
  const updated = await grantStudentRole(user.id);
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
