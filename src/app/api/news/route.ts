import { NextRequest, NextResponse } from "next/server";
import { readNewsFeed } from "@/lib/economic-news/repository";
import { requireApiUser } from "@/lib/api-auth";
import { newsEventId } from "@/lib/economic-news/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) {
    const response = unauthorized ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Cookie");
    return response;
  }
  const rawId = request.nextUrl.searchParams.get("event") ?? "";
  const eventId = newsEventId(rawId);
  const feed = await readNewsFeed(Date.now(), eventId);
  return NextResponse.json(feed, { headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });
}
