import { NextRequest, NextResponse } from "next/server";
import { closePurchaseRequestManually } from "@/lib/alpha-exchange-store";
import { requireApiUser, requirePhoneVerificationForTrading } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  const phoneVerificationRequired = requirePhoneVerificationForTrading(user);
  if (phoneVerificationRequired) return phoneVerificationRequired;

  const rate = checkRateLimit({
    headers: request.headers,
    key: "exchange:trade-manual-close",
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many close requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  try {
    const body = await request.json();
    const { requestId } = await context.params;
    const reason = String(body.reason ?? "").trim();
    const explanation = String(body.explanation ?? "").trim();
    const trade = await closePurchaseRequestManually({
      requestId,
      actorUserId: user.id,
      actorRole: user.role,
      reason,
      explanation,
    });
    return NextResponse.json({ request: trade });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to close trade.";
    const status = message === "Trade not found."
      ? 404
      : message.includes("not allowed")
        ? 403
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
