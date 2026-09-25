import { NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/api-auth";
import { readOwnerLiveAnalytics } from "@/lib/owner-live-analytics-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function GET() {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) {
    const response = unauthorized ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
  const snapshot = await readOwnerLiveAnalytics();
  const unavailable = snapshot.presence.status === "unavailable" && snapshot.traffic.status === "unavailable";
  return NextResponse.json(snapshot, { status: unavailable ? 503 : 200, headers });
}
