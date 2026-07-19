import { NextRequest, NextResponse } from "next/server";
import { submitBuyerTradeReview, submitSellerReviewResponse } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = checkRateLimit({
    headers: request.headers,
    key: "exchange:review-submit",
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many review actions. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  try {
    const { requestId } = await context.params;
    const body = await request.json();
    const mode = String(body.mode ?? "buyer_review").trim();

    if (mode === "buyer_review") {
      const rating = Number(body.rating ?? 0);
      const comment = String(body.comment ?? "");
      const updated = await submitBuyerTradeReview({
        requestId,
        buyerUserId: user.id,
        rating,
        comment,
      });
      return NextResponse.json({ request: updated });
    }

    if (mode === "seller_response") {
      const message = String(body.message ?? "");
      const updated = await submitSellerReviewResponse({
        requestId,
        sellerUserId: user.id,
        message,
      });
      return NextResponse.json({ request: updated });
    }

    return NextResponse.json({ error: "Invalid review mode." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to submit review." }, { status: 400 });
  }
}
