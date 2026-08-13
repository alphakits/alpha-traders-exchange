import { NextRequest, NextResponse } from "next/server";
import { getTradeRoomBankDetails } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  try {
    const { requestId } = await context.params;
    const bankDetails = await getTradeRoomBankDetails({
      purchaseRequestId: requestId,
      actorUserId: user.id,
      actorRole: user.role,
    });
    return NextResponse.json({ bankDetails });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load bank details.";
    const status = message === "Trade not found."
      ? 404
      : message.includes("not allowed") || message.includes("only after")
        ? 403
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
