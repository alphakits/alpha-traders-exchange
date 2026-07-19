import { NextResponse } from "next/server";
import { getCurrentSessionUser } from "@/lib/auth";
import { getPremiumSellerProfile } from "@/lib/alpha-exchange-store";

type RouteContext = {
  params: Promise<{ sellerId: string }>;
};

export async function GET(_: Request, context: RouteContext) {
  try {
    const { sellerId } = await context.params;
    const viewer = await getCurrentSessionUser();
    const profile = await getPremiumSellerProfile({
      sellerId,
      viewerUserId: viewer?.id,
      viewerRole: viewer?.role,
      viewerEmail: viewer?.email,
    });
    if (!profile) {
      return NextResponse.json({ error: "Seller profile not found." }, { status: 404 });
    }
    return NextResponse.json({ profile });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load seller profile." }, { status: 400 });
  }
}
