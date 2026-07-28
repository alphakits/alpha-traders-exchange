import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { selectGuestOnboarding } from "@/lib/alpha-exchange-store";

export async function POST() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
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
