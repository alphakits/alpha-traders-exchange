import { NextRequest, NextResponse } from "next/server";
import { createSellerApplication, getSellerApplicationByUserId } from "@/lib/alpha-exchange-store";
import { requireApiUser, requirePhoneVerificationForTrading } from "@/lib/api-auth";
import { isAlphaExchangeOwnerEmail } from "@/lib/alpha-exchange-identity";
import { hasRole } from "@/lib/roles";
import { logEvent } from "@/lib/structured-logging";
import { checkRateLimit, createRateLimitResponse } from "@/lib/rate-limit";
import type { SupportedNetwork } from "@/types/alpha-exchange";

function isValidNetwork(value: string): value is SupportedNetwork {
  return value === "TRC20" || value === "ERC20" || value === "BEP20" || value === "SOL";
}

const SELLER_APPLICATION_ERROR_STATUS: Record<string, number> = {
  "Account not found.": 404,
  "Owner accounts cannot submit seller applications.": 403,
  "Administrator accounts cannot submit seller applications.": 403,
  "You are already an approved seller.": 400,
  "Your seller application is already pending review.": 400,
  "Your account is suspended.": 403,
  "Buyer verification required before seller application.": 403,
  "Full name is required.": 400,
  "WhatsApp number is required.": 400,
  "At least one preferred network is required.": 400,
};

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const application = await getSellerApplicationByUserId(user.id);
  return NextResponse.json({ application });
}

export async function POST(request: NextRequest) {
  const routeStartedAt = Date.now();
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const phoneVerificationRequired = requirePhoneVerificationForTrading(user);
  if (phoneVerificationRequired) return phoneVerificationRequired;
  const rate = checkRateLimit({ headers: request.headers, key: "exchange:seller-application", maxRequests: 6, windowMs: 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);
  if (isAlphaExchangeOwnerEmail(user.email)) {
    logEvent("warn", { event: "seller_application_submit", actorUserId: user.id, actorRole: user.role, outcome: "denied", reason: "Owner cannot apply as seller" });
    return NextResponse.json({ error: "Owner accounts cannot submit seller applications." }, { status: 403 });
  }
  if (hasRole(user, "admin")) {
    logEvent("warn", { event: "seller_application_submit", actorUserId: user.id, actorRole: user.role, outcome: "denied", reason: "Admin cannot apply as seller" });
    return NextResponse.json({ error: "Administrator accounts cannot submit seller applications." }, { status: 403 });
  }
  if (!hasRole(user, "buyer")) {
    logEvent("warn", { event: "seller_application_submit", actorUserId: user.id, actorRole: user.role, outcome: "denied", reason: "Buyer verification required" });
    return NextResponse.json({ error: "Buyer verification required before seller application." }, { status: 403 });
  }
  if (user.sellerStatus === "approved_seller") {
    return NextResponse.json({ error: "You are already an approved seller." }, { status: 400 });
  }
  if (user.sellerStatus === "pending_seller_approval") {
    return NextResponse.json({ error: "Your seller application is already pending review." }, { status: 400 });
  }
  if (user.sellerStatus === "suspended") {
    return NextResponse.json({ error: "Your account is suspended." }, { status: 403 });
  }

  let payload: Record<string, unknown> = {};
  const validationStartedAt = Date.now();
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      payload = body as Record<string, unknown>;
    }
  } catch (error) {
    console.error("[alpha-exchange][seller-application][POST][invalid-json]", {
      userId: user.id,
      userEmail: user.email,
      error,
    });
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const preferredNetworksInput = payload.preferredNetworks;
  const preferredNetworksRaw = Array.isArray(preferredNetworksInput)
    ? preferredNetworksInput.map((value) => String(value))
    : [String(preferredNetworksInput ?? "")].filter(Boolean);
  const preferredNetworks = preferredNetworksRaw.filter(isValidNetwork);

  const fullName = String(payload.fullName ?? user.fullName).trim();
  const whatsappNumber = String(payload.whatsappNumber ?? user.whatsappNumber).trim();

  if (!fullName) {
    return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  }
  if (!whatsappNumber) {
    return NextResponse.json({ error: "WhatsApp number is required." }, { status: 400 });
  }
  if (preferredNetworks.length === 0) {
    return NextResponse.json({ error: "At least one preferred network is required." }, { status: 400 });
  }
  const validationMs = Date.now() - validationStartedAt;

  try {
    const logicStartedAt = Date.now();
    const application = await createSellerApplication({
      userId: user.id,
      fullName,
      email: String(payload.email ?? user.email),
      whatsappNumber,
      preferredNetworks,
      expectedMonthlyTradingVolume: String(payload.expectedMonthlyTradingVolume ?? ""),
      additionalNotes: String(payload.additionalNotes ?? ""),
    });
    logEvent("info", {
      event: "seller_application_submit",
      actorUserId: user.id,
      actorRole: user.role,
      resourceId: application.id,
      outcome: "success",
    });
    const logicMs = Date.now() - logicStartedAt;
    const routeMs = Date.now() - routeStartedAt;
    return NextResponse.json({ application }, {
      status: 201,
      headers: {
        "X-Trade-Route-Ms": String(routeMs),
        "X-Trade-Validation-Ms": String(validationMs),
        "X-Trade-Logic-Ms": String(logicMs),
        "Server-Timing": `route;dur=${routeMs}, validate;dur=${validationMs}, logic;dur=${logicMs}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown seller-application failure";
    console.error("[alpha-exchange][seller-application][POST]", {
      userId: user.id,
      userEmail: user.email,
      message,
      stack: error instanceof Error ? error.stack : undefined,
      error,
    });
    logEvent("error", {
      event: "seller_application_submit",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "failed",
      reason: message,
    });
    if (error instanceof Error) {
      if (Object.prototype.hasOwnProperty.call(SELLER_APPLICATION_ERROR_STATUS, error.message)) {
        const mappedStatus = SELLER_APPLICATION_ERROR_STATUS[error.message];
        return NextResponse.json(
          { error: error.message },
          { status: mappedStatus },
        );
      }
      if (/\brequired\b/i.test(error.message)) {
        return NextResponse.json(
          { error: error.message },
          { status: 400 },
        );
      }
    }
    return NextResponse.json({ error: "An unexpected error occurred. Please try again." }, { status: 500 });
  }
}
