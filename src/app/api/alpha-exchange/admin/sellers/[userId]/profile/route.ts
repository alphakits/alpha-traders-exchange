import { NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/api-auth";
import { getPremiumSellerProfile } from "@/lib/alpha-exchange-store";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

export async function GET(_: Request, context: { params: Promise<{ userId: string }> }) {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) return unauthorized;
  try {
    const { userId } = await context.params;
    const profile = await getPremiumSellerProfile({
      sellerId: userId,
      viewerUserId: user.id,
      includePrivateData: true,
    });
    if (!profile?.ownerTools) {
      return NextResponse.json({ error: "Seller profile not found." }, { status: 404, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json({ profile }, { headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json({ error: "Seller profile temporarily unavailable." }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
