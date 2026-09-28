import { NextRequest, NextResponse } from "next/server";
import { readNewsFeed } from "@/lib/economic-news/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rawId = request.nextUrl.searchParams.get("event") ?? "";
  const eventId = /^te-\d{1,24}$/.test(rawId) ? rawId : undefined;
  const feed = await readNewsFeed(Date.now(), eventId);
  return NextResponse.json(feed, { headers: { "Cache-Control": "public, max-age=0, s-maxage=20, stale-while-revalidate=30" } });
}
