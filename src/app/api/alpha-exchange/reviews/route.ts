import { NextRequest, NextResponse } from "next/server";
import { getSellerReviews, moderateSellerReview, submitBuyerTradeReview } from "@/lib/alpha-exchange-store";
import { requireApiUser, requireEmailVerificationForTrading } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const { searchParams } = new URL(request.url);
  const sellerId = searchParams.get("sellerId")?.trim();
  if (!sellerId) return NextResponse.json({ error: "sellerId is required." }, { status: 400 });
  const reviews = await getSellerReviews({ sellerId, actorUserId: user.id, actorRole: user.role as never });
  return NextResponse.json({ reviews });
}

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const emailVerificationRequired = requireEmailVerificationForTrading(user);
  if (emailVerificationRequired) return emailVerificationRequired;
  try {
    const body = await request.json();
    const requestId = String(body.requestId ?? "").trim();
    const rating = Number(body.rating ?? 0);
    const comment = String(body.comment ?? "").trim();
    const created = await submitBuyerTradeReview({
      requestId,
      buyerUserId: user.id,
      rating,
      comment,
    });
    return NextResponse.json({ review: created });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create review." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  try {
    const body = await request.json();
    const reviewId = String(body.reviewId ?? "").trim();
    const hidden = Boolean(body.hidden);
    const hiddenReason = String(body.hiddenReason ?? "").trim();
    const updated = await moderateSellerReview({
      reviewId,
      actorUserId: user.id,
      actorRole: user.role as never,
      hidden,
      hiddenReason,
    });
    return NextResponse.json({ review: updated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to moderate review." }, { status: 400 });
  }
}
