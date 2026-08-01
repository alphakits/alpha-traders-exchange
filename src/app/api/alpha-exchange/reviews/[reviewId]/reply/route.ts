import { NextRequest, NextResponse } from "next/server";
import { submitSellerReviewResponse } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ reviewId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const routeStartedAt = Date.now();
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  try {
    const { reviewId } = await context.params;
    const validationStartedAt = Date.now();
    const body = await request.json();
    const requestId = String(body.requestId ?? "").trim();
    const message = String(body.message ?? "").trim();
    const validationMs = Date.now() - validationStartedAt;
    const logicStartedAt = Date.now();
    const review = await submitSellerReviewResponse({
      requestId,
      sellerUserId: user.id,
      message,
    });
    const logicMs = Date.now() - logicStartedAt;
    const routeMs = Date.now() - routeStartedAt;
    return NextResponse.json({ review, reviewId }, {
      headers: {
        "X-Trade-Route-Ms": String(routeMs),
        "X-Trade-Validation-Ms": String(validationMs),
        "X-Trade-Logic-Ms": String(logicMs),
        "Server-Timing": `route;dur=${routeMs}, validate;dur=${validationMs}, logic;dur=${logicMs}`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to reply to review." }, { status: 400 });
  }
}
