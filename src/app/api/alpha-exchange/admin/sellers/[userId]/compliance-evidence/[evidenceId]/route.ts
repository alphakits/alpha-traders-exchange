import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { downloadMarketplaceComplianceEvidenceById } from "@/lib/alpha-exchange-store";

type RouteContext = {
  params: Promise<{ userId: string; evidenceId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { userId, evidenceId } = await context.params;
    const payload = await downloadMarketplaceComplianceEvidenceById({
      sellerId: userId,
      evidenceId,
      actorUserId: user.id,
      actorRole: user.role,
    });

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load compliance evidence." },
      { status: 400 },
    );
  }
}
