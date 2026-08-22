import { after, NextRequest, NextResponse } from "next/server";
import { getTradeEvidenceForRequest, uploadTradeEvidence } from "@/lib/alpha-exchange-store";
import { requireApiUser, requireEmailVerificationForTrading } from "@/lib/api-auth";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { prepareTradeEventEmails } from "@/lib/marketplace-email-events";
import { allowsRuntimeDiagnostics } from "@/lib/runtime-safety";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

function normalizeBase64Payload(value: string) {
  const trimmed = String(value ?? "").trim();
  const marker = ";base64,";
  const markerIndex = trimmed.indexOf(marker);
  if (markerIndex === -1) {
    return { mimeTypeFromDataUrl: "", contentBase64: trimmed };
  }
  const prefix = trimmed.slice(0, markerIndex);
  const mimeTypeFromDataUrl = prefix.startsWith("data:") ? prefix.slice(5) : "";
  return {
    mimeTypeFromDataUrl,
    contentBase64: trimmed.slice(markerIndex + marker.length),
  };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const emailVerificationRequired = requireEmailVerificationForTrading(user);
  if (emailVerificationRequired) return emailVerificationRequired;
  try {
    const { requestId } = await context.params;
    const trade = await getTradeEvidenceForRequest({
      purchaseRequestId: requestId,
      actorUserId: user.id,
      actorRole: user.role,
    });
    return NextResponse.json({ request: trade });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load trade evidence." }, { status: 400 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const emailVerificationRequired = requireEmailVerificationForTrading(user);
  if (emailVerificationRequired) return emailVerificationRequired;
  const rate = await checkSharedRateLimit({
    headers: request.headers,
    key: "exchange:trade-evidence-upload",
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many evidence uploads. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }
  const routeStartedAt = Date.now();
  try {
    const { requestId } = await context.params;
    const body = await request.json();
    const side = String(body.side ?? "").trim();
    if (side !== "buyer" && side !== "seller") {
      return NextResponse.json({ error: "Evidence side must be buyer or seller." }, { status: 400 });
    }
    const fileName = String(body.fileName ?? "").trim();
    const suppliedMimeType = String(body.mimeType ?? "").trim().toLowerCase();
    const suppliedSize = Number(body.sizeBytes ?? 0);
    const payload = normalizeBase64Payload(String(body.fileData ?? body.contentBase64 ?? ""));
    if (!payload.contentBase64) {
      return NextResponse.json({ error: "Evidence file payload is required." }, { status: 400 });
    }
    const uploaded = await uploadTradeEvidence({
      purchaseRequestId: requestId,
      actorUserId: user.id,
      actorRole: user.role,
      side,
      fileName,
      mimeType: suppliedMimeType || payload.mimeTypeFromDataUrl,
      sizeBytes: Number.isFinite(suppliedSize) && suppliedSize > 0 ? suppliedSize : Math.ceil((payload.contentBase64.length * 3) / 4),
      contentBase64: payload.contentBase64,
    });
    if (uploaded.metrics.autoAdvancedToPaymentSent) {
      const deliverTradeEmails = await prepareTradeEventEmails({ event: "buyer_payment_sent", request: uploaded.request });
      after(deliverTradeEmails);
    }
    if (uploaded.metrics.autoAdvancedToUsdtSent) {
      const deliverTradeEmails = await prepareTradeEventEmails({ event: "seller_usdt_released", request: uploaded.request });
      after(deliverTradeEmails);
    }
    const routeMs = Date.now() - routeStartedAt;
    if (allowsRuntimeDiagnostics() && process.env.ALPHA_EXCHANGE_DEBUG_TRADE_ROOM === "1") {
      console.log("[trade-room-perf] evidence timings", {
        requestId,
        actorUserId: user.id,
        side,
        validationMs: uploaded.metrics.validationMs,
        storageMs: uploaded.metrics.storageMs,
        dbWriteMs: uploaded.metrics.dbWriteMs,
        routeMs,
        autoAdvancedToPaymentSent: uploaded.metrics.autoAdvancedToPaymentSent,
        autoAdvancedToUsdtSent: uploaded.metrics.autoAdvancedToUsdtSent,
        statusAfter: uploaded.request.status,
      });
    }
    return NextResponse.json(
      { request: uploaded.request, metrics: uploaded.metrics },
      {
        headers: {
          "X-Trade-Evidence-Read-Ms": String(uploaded.metrics.dbReadMs),
          "X-Trade-Evidence-Validation-Ms": String(uploaded.metrics.validationMs),
          "X-Trade-Evidence-Storage-Ms": String(uploaded.metrics.storageMs),
          "X-Trade-Evidence-Write-Ms": String(uploaded.metrics.dbWriteMs),
          "X-Trade-Evidence-Route-Ms": String(routeMs),
          "Server-Timing": `route;dur=${routeMs}, read;dur=${uploaded.metrics.dbReadMs}, validate;dur=${uploaded.metrics.validationMs}, storage;dur=${uploaded.metrics.storageMs}, write;dur=${uploaded.metrics.dbWriteMs}`,
        },
      },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to upload evidence." }, { status: 400 });
  }
}
