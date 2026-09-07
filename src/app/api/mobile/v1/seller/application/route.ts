import { NextRequest } from "next/server";
import type { MobileSellerApplicationRequest } from "@alpha-traders/contracts";
import {
  createSellerApplication,
  findUserById,
  getSellerApplicationByUserId,
} from "@/lib/alpha-exchange-store";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  readMobileJsonBody,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import { toMobileSessionUser } from "@/lib/mobile-session-user";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";

const SELLER_METHODS = new Set([
  "USDT (ERC20 / Ethereum)",
  "USDT (Polygon)",
  "USDT (Solana SPL / Phantom)",
  "Face-to-Face",
  "Cardless Withdrawal",
  "Bank Transfer",
]);

function applicationSummary(application: Awaited<ReturnType<typeof getSellerApplicationByUserId>>) {
  if (!application) return null;
  return {
    id: application.id,
    status: application.status,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
  };
}

export async function GET(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const application = await getSellerApplicationByUserId(auth.user.id);
    return mobileJson({ application: applicationSummary(application) }, requestId);
  } catch {
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}

export async function POST(request: NextRequest) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:seller:application",
      identifier: auth.user.id,
      maxRequests: 6,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    const body = await readMobileJsonBody(request) as MobileSellerApplicationRequest | null;
    const fullName = String(body?.fullName ?? auth.user.fullName).trim();
    const whatsappNumber = String(body?.whatsappNumber ?? "").trim();
    const preferredNetworks = Array.isArray(body?.preferredNetworks)
      ? body.preferredNetworks.map((value) => String(value).trim()).filter((value) => SELLER_METHODS.has(value))
      : [];
    const expectedMonthlyTradingVolume = String(body?.expectedMonthlyTradingVolume ?? "").trim();
    const additionalNotes = String(body?.additionalNotes ?? "").trim();
    if (
      !fullName
      || fullName.length > 100
      || !whatsappNumber
      || whatsappNumber.length > 30
      || preferredNetworks.length < 1
      || preferredNetworks.length > SELLER_METHODS.size
      || expectedMonthlyTradingVolume.length > 100
      || additionalNotes.length > 2_000
    ) {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }

    const application = await createSellerApplication({
      userId: auth.user.id,
      fullName,
      email: auth.user.email,
      whatsappNumber,
      preferredNetworks,
      expectedMonthlyTradingVolume,
      additionalNotes,
    });
    const updated = await findUserById(auth.user.id);
    if (!updated) return mobileError("UNAUTHORIZED", requestId, locale, 401);
    logEvent("info", {
      event: "mobile_seller_application_submit",
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      resourceId: application.id,
      outcome: "success",
      metadata: { requestId },
    });
    return mobileJson({
      application: applicationSummary(application),
      user: toMobileSessionUser(updated),
    }, requestId, { status: 201 });
  } catch (error) {
    logEvent("warn", {
      event: "mobile_seller_application_submit",
      outcome: "failed",
      reason: "invalid_or_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }
}
