import { NextRequest, NextResponse } from "next/server";
import { downloadTradeEvidenceContent } from "@/lib/alpha-exchange-store";
import { requireApiUser, requirePhoneVerificationForTrading } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";

type RouteContext = {
  params: Promise<{ requestId: string; evidenceId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const phoneVerificationRequired = requirePhoneVerificationForTrading(user);
  if (phoneVerificationRequired) return phoneVerificationRequired;
  const rate = checkRateLimit({
    headers: request.headers,
    key: "exchange:trade-evidence-download",
    maxRequests: 60,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many evidence requests. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }
  try {
    const { requestId, evidenceId } = await context.params;
    const payload = await downloadTradeEvidenceContent({
      evidenceId,
      actorUserId: user.id,
      actorRole: user.role,
    });
    if (payload.request.id !== requestId) {
      return NextResponse.json({ error: "Evidence not found for this trade." }, { status: 404 });
    }
    const safeFileName = encodeURIComponent(payload.evidence.fileName.replace(/[^\w.\-]/g, "_"));
    return new NextResponse(new Uint8Array(payload.buffer), {
      status: 200,
      headers: {
        "Content-Type": payload.evidence.mimeType,
        "Content-Length": String(payload.buffer.byteLength),
        "Content-Disposition": `inline; filename*=UTF-8''${safeFileName}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load evidence." }, { status: 400 });
  }
}
