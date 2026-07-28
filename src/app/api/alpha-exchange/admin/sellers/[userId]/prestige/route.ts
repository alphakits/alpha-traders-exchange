import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { overrideSellerPrestigeByAdmin } from "@/lib/alpha-exchange-store";
import { logEvent } from "@/lib/structured-logging";
import type { SellerLevel } from "@/types/alpha-exchange";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

function isSellerLevel(value: string): value is SellerLevel {
  return value === "bronze" || value === "silver" || value === "gold" || value === "platinum" || value === "diamond" || value === "legendary";
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  try {
    const { userId } = await context.params;
    const body = await request.json();
    const clearOverride = body.clearOverride === true;
    const rankRaw = String(body.rank ?? "").trim().toLowerCase();
    const reason = String(body.reason ?? "").trim();
    if (!clearOverride && !isSellerLevel(rankRaw)) {
      return NextResponse.json({ error: "Invalid seller prestige rank." }, { status: 400 });
    }
    if (!clearOverride && !reason) {
      return NextResponse.json({ error: "Override reason is required." }, { status: 400 });
    }
    const seller = await overrideSellerPrestigeByAdmin({
      sellerId: userId,
      adminUserId: user.id,
      rank: (isSellerLevel(rankRaw) ? rankRaw : "bronze"),
      reason,
      clearOverride,
    });
    logEvent("info", {
      event: "seller_prestige_override",
      actorUserId: user.id,
      actorRole: user.role,
      targetUserId: userId,
      outcome: "success",
    });
    return NextResponse.json({ seller });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update seller prestige.";
    logEvent("error", {
      event: "seller_prestige_override",
      actorUserId: user.id,
      actorRole: user.role,
      outcome: "failed",
      reason: message,
    });
    const status = message.includes("Owner account cannot be modified") ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
