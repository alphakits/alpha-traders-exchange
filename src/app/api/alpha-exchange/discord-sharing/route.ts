import { NextResponse } from "next/server";

import { requireApiSellerWorkspaceActor } from "@/lib/api-auth";
import { getDiscordListingSharingStatus } from "@/lib/discord/listing-share-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, unauthorized } = await requireApiSellerWorkspaceActor();
  if (!user) return unauthorized;

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
