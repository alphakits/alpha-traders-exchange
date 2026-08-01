import { NextRequest, NextResponse } from "next/server";
import { getTradeEvidenceForRequest, uploadTradeEvidence } from "@/lib/alpha-exchange-store";
import { requireApiUser, requirePhoneVerificationForTrading } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";

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
  const phoneVerificationRequired = requirePhoneVerificationForTrading(user);
  if (phoneVerificationRequired) return phoneVerificationRequired;
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
  const phoneVerificationRequired = requirePhoneVerificationForTrading(user);
  if (phoneVerificationRequired) return phoneVerificationRequired;
  const rate = checkRateLimit({
    headers: request.headers,
    key: "exchange:trade-evidence-upload",
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many evidence uploads. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }
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
    return NextResponse.json({ request: uploaded });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to upload evidence." }, { status: 400 });
  }
}
