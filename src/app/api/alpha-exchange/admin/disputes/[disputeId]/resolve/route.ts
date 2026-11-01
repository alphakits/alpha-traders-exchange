import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { resolveTradeDisputeByAdmin } from "@/lib/alpha-exchange-store";

type RouteContext = { params: Promise<{ disputeId: string }> };

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { disputeId } = await context.params;
    const body = await request.json() as { resolutionNotes?: string };
    const resolutionNotes = String(body.resolutionNotes ?? "").trim();
    if (!resolutionNotes) {
      return NextResponse.json(
        { error: "Resolution notes are required." },
        { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    const dispute = await resolveTradeDisputeByAdmin({
      disputeId,
      actorUserId: user.id,
      actorRole: user.role,
      resolutionNotes,
    });
    return NextResponse.json({ dispute }, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve dispute.";
    const status = message === "Dispute not found." || message === "Trade not found." ? 404 : 400;
    return NextResponse.json({ error: message }, { status, headers: PRIVATE_NO_STORE_HEADERS });
  }
}
