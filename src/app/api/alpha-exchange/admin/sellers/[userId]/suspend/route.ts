import { NextResponse } from "next/server";
import { suspendApprovedSellerByAdmin } from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";

type RouteContext = {
  params: Promise<{ userId: string }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { userId } = await context.params;
    const seller = await suspendApprovedSellerByAdmin(userId, user.id);
    return NextResponse.json({ seller });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to suspend seller." }, { status: 400 });
  }
}
