import { NextRequest, NextResponse } from "next/server";
import { submitBuyerTradeReview, submitSellerReviewResponse } from "@/lib/alpha-exchange-store";
import { requireApiUser, requirePhoneVerificationForTrading } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const routeStartedAt = Date.now();
  console.info("[review-submit-diag][api] request-received", { ts: new Date(routeStartedAt).toISOString() });
  const { user, unauthorized } = await requireApiUser();
  if (!user) {
    console.info("[review-submit-diag][api] request-unauthorized");
    return unauthorized;
  }
  const phoneVerificationRequired = requirePhoneVerificationForTrading(user);
  if (phoneVerificationRequired) {
    console.info("[review-submit-diag][api] request-blocked-phone-verification", { userId: user.id });
    return phoneVerificationRequired;
  }
  const rate = checkRateLimit({
    headers: request.headers,
    key: "exchange:review-submit",
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    console.info("[review-submit-diag][api] request-rate-limited", { userId: user.id });
    return NextResponse.json({ error: "Too many review actions. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  try {
    const { requestId } = await context.params;
    const validationStartedAt = Date.now();
    console.info("[review-submit-diag][api] validation-started", { requestId, userId: user.id });
    const body = await request.json();
    const mode = String(body.mode ?? "buyer_review").trim();
    console.info("[review-submit-diag][api] mode-read", { requestId, userId: user.id, mode });

    if (mode === "buyer_review") {
      const rating = Number(body.rating ?? 0);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        console.info("[review-submit-diag][api] validation-failed", { requestId, userId: user.id, reason: "invalid-rating", rating });
        return NextResponse.json({ error: "Rating must be a whole number between 1 and 5." }, { status: 400 });
      }
      const comment = String(body.comment ?? "").slice(0, 2000);
      if (!comment.trim()) {
        console.info("[review-submit-diag][api] validation-failed", { requestId, userId: user.id, reason: "empty-comment" });
      } else {
        console.info("[review-submit-diag][api] validation-passed", { requestId, userId: user.id, rating, commentLength: comment.trim().length });
      }
      const validationMs = Date.now() - validationStartedAt;
      const logicStartedAt = Date.now();
      console.info("[review-submit-diag][api] submit-handler-started", { requestId, userId: user.id });
      const updated = await submitBuyerTradeReview({
        requestId,
        buyerUserId: user.id,
        rating,
        comment,
      });
      const logicMs = Date.now() - logicStartedAt;
      const routeMs = Date.now() - routeStartedAt;
      console.info("[review-submit-diag][api] success-handler-executed", { requestId, userId: user.id, status: 200, routeMs, logicMs });
      return NextResponse.json(updated, {
        headers: {
          "X-Trade-Route-Ms": String(routeMs),
          "X-Trade-Validation-Ms": String(validationMs),
          "X-Trade-Logic-Ms": String(logicMs),
          "Server-Timing": `route;dur=${routeMs}, validate;dur=${validationMs}, logic;dur=${logicMs}`,
        },
      });
    }

    if (mode === "seller_response") {
      const message = String(body.message ?? "").slice(0, 2000);
      console.info("[review-submit-diag][api] validation-passed", { requestId, userId: user.id, mode, messageLength: message.trim().length });
      const validationMs = Date.now() - validationStartedAt;
      const logicStartedAt = Date.now();
      console.info("[review-submit-diag][api] submit-handler-started", { requestId, userId: user.id, mode });
      const updated = await submitSellerReviewResponse({
        requestId,
        sellerUserId: user.id,
        message,
      });
      const logicMs = Date.now() - logicStartedAt;
      const routeMs = Date.now() - routeStartedAt;
      console.info("[review-submit-diag][api] success-handler-executed", { requestId, userId: user.id, mode, status: 200, routeMs, logicMs });
      return NextResponse.json({ request: updated }, {
        headers: {
          "X-Trade-Route-Ms": String(routeMs),
          "X-Trade-Validation-Ms": String(validationMs),
          "X-Trade-Logic-Ms": String(logicMs),
          "Server-Timing": `route;dur=${routeMs}, validate;dur=${validationMs}, logic;dur=${logicMs}`,
        },
      });
    }

    console.info("[review-submit-diag][api] validation-failed", { requestId, userId: user.id, reason: "invalid-mode", mode });
    return NextResponse.json({ error: "Invalid review mode." }, { status: 400 });
  } catch (error) {
    console.error("[review-submit-diag][api] error-handler-executed", { error: error instanceof Error ? error.message : "unknown-error" });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to submit review." }, { status: 400 });
  }
}
