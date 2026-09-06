import { after, NextRequest } from "next/server";
import { getTradeRoomData, uploadTradeEvidence } from "@/lib/alpha-exchange-store";
import { requireMobileApiUser } from "@/lib/mobile-api-auth";
import {
  createMobileRequestId,
  mobileError,
  mobileJson,
  parseMobileClientMetadata,
  resolveMobileLocale,
} from "@/lib/mobile-api";
import {
  isMobileTradeParticipant,
  mobileTradeErrorCode,
  mobileTradeErrorStatus,
  toMobileTradeSummary,
} from "@/lib/mobile-trades";
import { prepareTradeEventEmails } from "@/lib/marketplace-email-events";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const MAX_JSON_BYTES = Math.ceil(MAX_EVIDENCE_BYTES * 1.38) + 4096;

export async function POST(request: NextRequest, context: RouteContext) {
  const requestId = createMobileRequestId(request);
  const locale = resolveMobileLocale(request);
  const metadata = parseMobileClientMetadata(request);
  if (!metadata) return mobileError("DEVICE_HEADERS_REQUIRED", requestId, locale, 400);
  const params = await context.params;
  if (!RESOURCE_ID_PATTERN.test(params.requestId)) {
    return mobileError("INVALID_REQUEST", requestId, locale, 400);
  }

  try {
    const auth = await requireMobileApiUser(request, requestId, metadata);
    if (!auth.user) return auth.unauthorized;
    const room = await getTradeRoomData({
      purchaseRequestId: params.requestId,
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      markMessagesRead: false,
      strongConsistency: true,
    });
    if (!isMobileTradeParticipant(room.request, auth.user.id)) {
      return mobileError("TRADE_NOT_FOUND", requestId, locale, 404);
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
      return mobileError("EVIDENCE_INVALID", requestId, locale, 413);
    }
    let body: Record<string, unknown>;
    try {
      const value: unknown = await request.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return mobileError("INVALID_REQUEST", requestId, locale, 400);
      }
      body = value as Record<string, unknown>;
    } catch {
      return mobileError("INVALID_REQUEST", requestId, locale, 400);
    }

    const expectedSide = room.request.buyerId === auth.user.id ? "buyer" : "seller";
    const side = String(body.side ?? "").trim();
    const mimeType = String(body.mimeType ?? "").trim().toLowerCase();
    const contentBase64 = String(body.contentBase64 ?? "").trim();
    const sizeBytes = Number(body.sizeBytes ?? 0);
    if (
      side !== expectedSide
      || !ALLOWED_MIME_TYPES.has(mimeType)
      || !Number.isFinite(sizeBytes)
      || sizeBytes <= 0
      || sizeBytes > MAX_EVIDENCE_BYTES
      || !contentBase64
      || contentBase64.length > Math.ceil(MAX_EVIDENCE_BYTES * 4 / 3) + 8
    ) {
      return mobileError("EVIDENCE_INVALID", requestId, locale, 400);
    }

    const rate = await checkSharedRateLimit({
      headers: request.headers,
      key: "mobile:trade:evidence",
      identifier: auth.user.id,
      maxRequests: 20,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return mobileError("RATE_LIMITED", requestId, locale, 429, {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    const uploaded = await uploadTradeEvidence({
      purchaseRequestId: params.requestId,
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      side,
      fileName: side === "buyer" ? "mobile-payment-evidence" : "mobile-release-evidence",
      mimeType,
      sizeBytes,
      contentBase64,
    });

    try {
      if (uploaded.metrics.autoAdvancedToPaymentSent) {
        const deliver = await prepareTradeEventEmails({ event: "buyer_payment_sent", request: uploaded.request });
        after(deliver);
      }
      if (uploaded.metrics.autoAdvancedToUsdtSent) {
        const deliver = await prepareTradeEventEmails({ event: "seller_usdt_released", request: uploaded.request });
        after(deliver);
      }
    } catch (emailError) {
      logEvent("error", {
        event: "mobile_trade_email_schedule",
        actorUserId: auth.user.id,
        resourceId: params.requestId,
        outcome: "failed",
        reason: "evidence_post_commit_schedule_failed",
        metadata: { errorType: emailError instanceof Error ? emailError.name : typeof emailError },
      });
    }

    return mobileJson({ trade: toMobileTradeSummary(uploaded.request, auth.user.id) }, requestId);
  } catch (error) {
    const code = mobileTradeErrorCode(error);
    if (code) return mobileError(code, requestId, locale, mobileTradeErrorStatus(code));
    logEvent("error", {
      event: "mobile_trade_evidence",
      outcome: "failed",
      reason: "service_unavailable",
      metadata: { errorType: error instanceof Error ? error.name : typeof error, requestId },
    });
    return mobileError("SERVICE_UNAVAILABLE", requestId, locale, 503);
  }
}
