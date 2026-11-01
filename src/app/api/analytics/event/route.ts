import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSessionUser } from "@/lib/auth";
import { analyticsKey, recordTrafficEvent } from "@/lib/traffic-analytics-store";
import { checkSharedRateLimit } from "@/lib/rate-limit";

const bodySchema = z.object({
  visitorId: z.string().min(16).max(100),
  sessionId: z.string().min(16).max(100),
  path: z.string().min(1).max(240),
  platform: z.enum(["web", "ios", "android"]),
  deviceType: z.enum(["mobile", "desktop"]),
  referrerHost: z.string().max(180).nullable().optional(),
}).strict();
const noStore = { "Cache-Control": "no-store" };

function unavailable() {
  return NextResponse.json({ error: "Analytics temporarily unavailable." }, {
    status: 503,
    headers: { ...noStore, "Retry-After": "60" },
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== request.nextUrl.origin)) {
    return NextResponse.json({ error: "Invalid origin." }, { status: 403, headers: noStore });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid event." }, { status: 400, headers: noStore });

  try {
    // Keep the trusted request-identity limiter; never key it by visitorId.
    const limit = await checkSharedRateLimit({
      headers: request.headers,
      key: "traffic-analytics",
      maxRequests: 180,
      windowMs: 60_000,
    });
    if (!limit.allowed) return NextResponse.json({ error: "Please retry shortly." }, { status: 429, headers: noStore });
    const user = await getCurrentSessionUser().catch(() => null);
    const recorded = await recordTrafficEvent({
      visitorKey: analyticsKey(parsed.data.visitorId),
      sessionKey: analyticsKey(parsed.data.sessionId),
      userId: user?.id,
      eventName: "page_view",
      path: parsed.data.path,
      platform: parsed.data.platform,
      deviceType: parsed.data.deviceType,
      referrerHost: parsed.data.referrerHost,
    });
    if (!recorded) return unavailable();
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch {
    // Do not leak database details or let optional telemetry affect trading.
    return unavailable();
  }
}
