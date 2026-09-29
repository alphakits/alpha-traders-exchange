import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiOwner } from "@/lib/api-auth";
import { readOwnerAnalyticsStart } from "@/lib/owner-analytics-period-store";
import { parseVisitorCursor, readOwnerVisitorDirectory, readOwnerVisitorTimeline } from "@/lib/owner-visitor-activity-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" };
const querySchema = z.object({ period: z.enum(["all","today"]).default("all"),
  person: z.string().regex(/^(user|visitor):[A-Za-z0-9_-]{1,200}$/).optional(), cursor: z.string().max(1200).optional() }).strict();

export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) {
    const response = unauthorized ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    for (const [key,value] of Object.entries(headers)) response.headers.set(key,value);
    return response;
  }
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid filters" }, { status: 400, headers });
  try { parseVisitorCursor(parsed.data.cursor); }
  catch { return NextResponse.json({ error: "Invalid cursor" }, { status: 400, headers }); }
  try {
    const startedAt = await readOwnerAnalyticsStart();
    const { period, person, cursor } = parsed.data;
    const data = person ? await readOwnerVisitorTimeline(startedAt,period,person,cursor)
      : await readOwnerVisitorDirectory(startedAt,period,cursor);
    return NextResponse.json(data, { headers });
  } catch {
    return NextResponse.json({ error: "Activity is temporarily unavailable. Please refresh." }, { status: 503, headers });
  }
}
