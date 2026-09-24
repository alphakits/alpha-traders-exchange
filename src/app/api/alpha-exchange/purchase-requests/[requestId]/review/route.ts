import { NextRequest, NextResponse } from "next/server";
import { submitBuyerTradeReview, submitSellerReviewResponse, submitSellerBuyerReview } from "@/lib/alpha-exchange-store";
import { requireApiUser, requireEmailVerificationForTrading } from "@/lib/api-auth";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const routeStartedAt = Date.now();
  const diagnosticId = request.headers.get("X-Review-Diagnostic-Id")?.trim().slice(0, 100) || null;
  const tracePhase = (phase: string) => logEvent("info", { event: "trade_review_phase", outcome: "success", metadata: { phase, diagnosticId, elapsedMs: Date.now() - routeStartedAt } });
  tracePhase("authentication_started");
  const { user, unauthorized } = await requireApiUser();
  tracePhase("authentication_finished");
  if (!user) {
    logEvent("warn", {
      event: "trade_review_submission",
      outcome: "denied",
      reason: "unauthenticated",
    });
    return unauthorized;
  }
  const emailVerificationRequired = requireEmailVerificationForTrading(user);
  if (emailVerificationRequired) {
    logEvent("warn", {
      event: "trade_review_submission",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "denied",
      reason: "email_verification_required",
    });
    return emailVerificationRequired;
  }
  tracePhase("rate_limit_started");
  const rate = await checkSharedRateLimit({
    headers: request.headers,
    key: "exchange:review-submit",
    identifier: user.id,
    maxRequests: 20,
    windowMs: 60_000,
  });
  tracePhase("rate_limit_finished");
  if (!rate.allowed) {
    logEvent("warn", {
      event: "trade_review_submission",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "denied",
      reason: "rate_limited",
    });
    return NextResponse.json({ error: "Too many review actions. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  try {
    const { requestId } = await context.params;
    const validationStartedAt = Date.now();
    const body = await request.json();
    const mode = String(body.mode ?? "buyer_review").trim();
    tracePhase("save_started");

    if (mode === "buyer_review") {
      const rating = Number(body.rating ?? 0);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        logEvent("warn", {
          event: "trade_review_submission",
          actorUserId: user.id,
          actorRole: user.role,
          resourceId: requestId,
          outcome: "denied",
          reason: "invalid_rating",
        });
        return NextResponse.json({ error: "Rating must be a whole number between 1 and 5." }, { status: 400 });
      }
      const comment = String(body.comment ?? "").slice(0, 2000);
      if (!comment.trim()) {
        logEvent("warn", {
          event: "trade_review_submission",
          actorUserId: user.id,
          actorRole: user.role,
          resourceId: requestId,
          outcome: "denied",
          reason: "empty_comment",
        });
      }
      const validationMs = Date.now() - validationStartedAt;
      const logicStartedAt = Date.now();
      const updated = await submitBuyerTradeReview({
        requestId,
        buyerUserId: user.id,
        rating,
        comment,
      });
      const logicMs = Date.now() - logicStartedAt;
      const routeMs = Date.now() - routeStartedAt;
      logEvent("info", {
        event: "trade_review_submission",
        actorUserId: user.id,
        actorRole: user.role,
        resourceId: requestId,
        outcome: "success",
        reason: "buyer_review_saved",
        metadata: { routeMs, logicMs },
      });
      return NextResponse.json(updated, {
        headers: {
          "X-Trade-Route-Ms": String(routeMs),
          "X-Trade-Validation-Ms": String(validationMs),
          "X-Trade-Logic-Ms": String(logicMs),
          ...(diagnosticId ? { "X-Review-Diagnostic-Id": diagnosticId } : {}),
          "Server-Timing": `route;dur=${routeMs}, validate;dur=${validationMs}, logic;dur=${logicMs}`,
        },
      });
    }

    if (mode === "seller_buyer_review") {
      const updated = await submitSellerBuyerReview({ requestId, sellerUserId: user.id,
        rating: Number(body.rating), comment: String(body.comment ?? "") });
      return NextResponse.json(updated, { headers: { "Cache-Control": "no-store" } });
    }

    if (mode === "seller_response") {
      const message = String(body.message ?? "").slice(0, 2000);
      const validationMs = Date.now() - validationStartedAt;
      const logicStartedAt = Date.now();
      const updated = await submitSellerReviewResponse({
        requestId,
        sellerUserId: user.id,
        message,
      });
      const logicMs = Date.now() - logicStartedAt;
      const routeMs = Date.now() - routeStartedAt;
      logEvent("info", {
        event: "trade_review_submission",
        actorUserId: user.id,
        actorRole: user.role,
        resourceId: requestId,
        outcome: "success",
        reason: "seller_response_saved",
        metadata: { routeMs, logicMs },
      });
      return NextResponse.json({ request: updated }, {
        headers: {
          "X-Trade-Route-Ms": String(routeMs),
          "X-Trade-Validation-Ms": String(validationMs),
          "X-Trade-Logic-Ms": String(logicMs),
          ...(diagnosticId ? { "X-Review-Diagnostic-Id": diagnosticId } : {}),
          "Server-Timing": `route;dur=${routeMs}, validate;dur=${validationMs}, logic;dur=${logicMs}`,
        },
      });
    }

    logEvent("warn", {
      event: "trade_review_submission",
      actorUserId: user.id,
      actorRole: user.role,
      resourceId: requestId,
      outcome: "denied",
      reason: "invalid_mode",
    });
    return NextResponse.json({ error: "Invalid review mode." }, { status: 400 });
  } catch (error) {
    const errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    const databaseUnavailable = (error instanceof Error && /query read timeout|statement timeout|timeout exceeded|connection terminated|connection closed|persistence.*unavailable/i.test(error.message))
      || (errorCode !== undefined && ["57014", "55P03", "08000", "08003", "08006", "57P01", "57P02", "57P03", "ETIMEDOUT", "ECONNRESET"].includes(errorCode));
    logEvent("error", {
      event: "trade_review_submission",
      outcome: "failed",
      reason: databaseUnavailable ? "database_unavailable" : "submission_failed",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, errorCode, diagnosticId, routeMs: Date.now() - routeStartedAt },
    });
    if (databaseUnavailable) {
      return NextResponse.json({ error: "Could not confirm your review was saved. Please submit the same feedback again.", code: "REVIEW_SAVE_UNCONFIRMED" }, {
        status: 503,
        headers: { "Retry-After": "2", "Cache-Control": "no-store" },
      });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to submit review." }, { status: 400 });
  }
}
