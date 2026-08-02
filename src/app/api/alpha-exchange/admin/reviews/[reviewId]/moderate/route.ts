import { NextRequest, NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { moderateSellerReview } from "@/lib/alpha-exchange-store";

type RouteContext = { params: Promise<{ reviewId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { reviewId } = await context.params;
    const body = await request.json() as { hide?: boolean; reason?: string };
    const hide = Boolean(body.hide);
    const reason = String(body.reason ?? "").trim();
    if (!reason) return NextResponse.json({ error: "Reason is required." }, { status: 400 });

    const review = await moderateSellerReview({
      reviewId,
      actorUserId: user.id,
      actorRole: user.role,
      hidden: hide,
      hiddenReason: hide ? reason : undefined,
    });
    return NextResponse.json({ review });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to moderate review." }, { status: 400 });
  }
}
