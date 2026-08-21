import { NextRequest, NextResponse } from "next/server";
import { getBetaFeedbackForUser, submitBetaFeedback } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import type { BetaFeedbackCategory } from "@/types/alpha-exchange";

function isFeedbackCategory(value: string): value is BetaFeedbackCategory {
  return value === "bug" || value === "suggestion" || value === "confusing_ux" || value === "feature_request" || value === "performance" || value === "other";
}

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const feedback = await getBetaFeedbackForUser(user.id);
  return NextResponse.json({ feedback });
}

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({
    headers: request.headers,
    key: "exchange:beta-feedback-submit",
    maxRequests: 8,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many feedback submissions. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }
  try {
    const body = await request.json();
    const categoryRaw = String(body.category ?? "").trim();
    const message = String(body.message ?? "").trim();
    if (!isFeedbackCategory(categoryRaw)) {
      return NextResponse.json({ error: "Invalid feedback category." }, { status: 400 });
    }
    const feedback = await submitBetaFeedback({
      userId: user.id,
      category: categoryRaw,
      message,
    });
    return NextResponse.json({ feedback }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to submit feedback." }, { status: 400 });
  }
}
