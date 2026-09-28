import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";
import { purgeMarketplaceSmokeTestByAdmin } from "@/lib/alpha-exchange-store";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ listingId: string }>;
};

export async function DELETE(_: Request, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { listingId } = await context.params;
    const result = await purgeMarketplaceSmokeTestByAdmin({
      listingId,
      actorUserId: user.id,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to purge smoke-test records." },
      { status: 400 },
    );
  }
}
