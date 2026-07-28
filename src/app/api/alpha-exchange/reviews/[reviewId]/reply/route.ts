import { NextRequest, NextResponse } from "next/server";
import { submitSellerReviewResponse } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ reviewId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  try {
    const { reviewId } = await context.params;
    const body = await request.json();
    const requestId = String(body.requestId ?? "").trim();
    const message = String(body.message ?? "").trim();
    const review = await submitSellerReviewResponse({
      requestId,
      sellerUserId: user.id,
      message,
    });
    return NextResponse.json({ review, reviewId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to reply to review." }, { status: 400 });
  }
}
