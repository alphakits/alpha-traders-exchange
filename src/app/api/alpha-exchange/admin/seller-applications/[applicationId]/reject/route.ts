import { NextResponse } from "next/server";
import { rejectSellerApplicationByAdmin } from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";

type RouteContext = {
  params: Promise<{ applicationId: string }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  try {
    const { applicationId } = await context.params;
    const application = await rejectSellerApplicationByAdmin(applicationId, user.id);
    return NextResponse.json({ application });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to reject seller application." }, { status: 400 });
  }
}
