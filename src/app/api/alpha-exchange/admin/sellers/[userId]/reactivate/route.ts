import { NextRequest, NextResponse } from "next/server";
import { reactivateSellerByAdmin } from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";
import { logEvent } from "@/lib/structured-logging";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { userId } = await context.params;
    const body = await request.json() as { reason?: string };
    const reason = String(body.reason ?? "").trim();
    if (!reason) {
      return NextResponse.json({ error: "Reason is required." }, { status: 400 });
    }
    const seller = await reactivateSellerByAdmin(userId, user.id, reason);
    logEvent("info", { event: "seller_reactivate", actorUserId: user.id, actorRole: user.role, targetUserId: userId, outcome: "success" });
    return NextResponse.json({ seller });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reactivate seller.";
    logEvent("error", { event: "seller_reactivate", actorUserId: user.id, actorRole: user.role, outcome: "failed", reason: message });
    const status = message === "Owner account cannot be modified." ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
