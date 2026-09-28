import { NextRequest, NextResponse } from "next/server";
import { updateBetaFeedbackStatus } from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";
import type { BetaFeedbackStatus } from "@/types/alpha-exchange";

type RouteContext = {
  params: Promise<{ feedbackId: string }>;
};

function isFeedbackStatus(value: string): value is BetaFeedbackStatus {
  return value === "new" || value === "in_review" || value === "resolved";
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  try {
    const { feedbackId } = await context.params;
    const body = await request.json();
    const statusRaw = String(body.status ?? "").trim();
    if (!isFeedbackStatus(statusRaw)) {
      return NextResponse.json({ error: "Invalid feedback status." }, { status: 400 });
    }
    const feedback = await updateBetaFeedbackStatus({
      ownerUserId: user.id,
      feedbackId,
      status: statusRaw,
    });
    return NextResponse.json({ feedback });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update feedback status." }, { status: 400 });
  }
}
