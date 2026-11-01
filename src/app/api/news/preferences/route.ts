import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api-auth";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";
import { readNewsPreferences, saveNewsPreferences } from "@/lib/economic-news/repository";
import { newsProviderConfigured } from "@/lib/economic-news/provider";

const headers = { "Cache-Control": "private, no-store" };
const schema = z.object({ inApp: z.boolean(), email: z.boolean() }).strict();

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  try {
    return NextResponse.json({
      available: newsProviderConfigured(), preferences: await readNewsPreferences(user.id),
      channels: { inApp: user.notificationPreferences?.inApp !== false, email: user.notificationPreferences?.email === true },
    }, { headers });
  } catch { return NextResponse.json({ error: "News preferences unavailable." }, { status: 503, headers }); }
}

export async function PATCH(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({ headers: request.headers, key: `news:preferences:${user.id}`, maxRequests: 12, windowMs: 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid news preferences." }, { status: 400, headers });
  if (!newsProviderConfigured()) return NextResponse.json({ error: "News alerts are not available yet." }, { status: 503, headers });
  try {
    return NextResponse.json({ preferences: await saveNewsPreferences(user.id, parsed.data) }, { headers });
  } catch { return NextResponse.json({ error: "Could not save news preferences." }, { status: 503, headers }); }
}
