import { NextResponse } from "next/server";

import { requireApiSellerWorkspaceActor } from "@/lib/api-auth";
import { getSellerMarketplaceEnforcementStatus } from "@/lib/alpha-exchange-store";
import { getDiscordListingSharingStatus } from "@/lib/discord/listing-share-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, unauthorized } = await requireApiSellerWorkspaceActor();
  if (!user) return unauthorized;

  const enforcement = await getSellerMarketplaceEnforcementStatus(user.id);
  if (enforcement.restricted) {
    return NextResponse.json(
      {
        error: enforcement.blockReason ?? "Marketplace restriction active.",
        code: "MARKETPLACE_RESTRICTION_ACTIVE",
        enforcement,
      },
      {
        status: 403,
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  }

  try {
    const sharing = await getDiscordListingSharingStatus(user.id);
    return NextResponse.json(sharing, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json(
      {
        error: "Discord listing sharing status is temporarily unavailable.",
        code: "SHARING_UNAVAILABLE",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  }
}
