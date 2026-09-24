import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSessionToken, getCurrentSessionUser } from "@/lib/auth";
import { requireApiUser } from "@/lib/api-auth";
import { getVisibleUserPresence } from "@/lib/alpha-exchange-store";
import { presenceSessionKey, recordUserPresence } from "@/lib/user-presence-store";
import { checkSharedRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const updateSchema = z.object({ clientId: z.string().uuid(), sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), active: z.boolean(), activity: z.boolean() }).strict();

export async function GET(request: NextRequest) {
  const ids = z.array(id).min(1).max(100).safeParse(request.nextUrl.searchParams.get("ids")?.split(","));
  if (!ids.success) return NextResponse.json({ error: "Invalid user IDs." }, { status: 400, headers });
  try {
    const viewer = await getCurrentSessionUser();
    const users = await getVisibleUserPresence(ids.data, viewer ?? undefined);
    return NextResponse.json({ users, serverTime: new Date().toISOString() }, { headers });
  } catch {
    return NextResponse.json({ error: "Activity temporarily unavailable." }, { status: 503, headers });
  }
}

export async function POST(request: NextRequest) {
  // Cookies are ambient authority: reject cross-origin writes, including beacons.
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== request.nextUrl.origin)) {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403, headers });
  }
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const body = await request.text();
  if (body.length > 512) return NextResponse.json({ error: "Invalid activity." }, { status: 400, headers });
  let update: ReturnType<typeof updateSchema.safeParse>;
  try { update = updateSchema.safeParse(JSON.parse(body)); } catch { return NextResponse.json({ error: "Invalid activity." }, { status: 400, headers }); }
  if (!update.success) return NextResponse.json({ error: "Invalid activity." }, { status: 400, headers });
  const limit = await checkSharedRateLimit({ headers: request.headers, key: "user-presence", identifier: user.id, maxRequests: 120, windowMs: 60_000 });
  if (!limit.allowed) return NextResponse.json({ error: "Please retry shortly." }, { status: 429, headers });
  try {
    const token = await getCurrentSessionToken();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
    await recordUserPresence(user.id, presenceSessionKey(token), update.data);
    return NextResponse.json({ ok: true }, { headers });
  } catch {
    return NextResponse.json({ error: "Activity temporarily unavailable." }, { status: 503, headers });
  }
}
