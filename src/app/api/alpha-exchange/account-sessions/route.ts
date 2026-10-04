import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api-auth";
import { getCurrentSessionToken, expireAuthCookies } from "@/lib/auth";
import { listAccountSessions, revokeAccountSession } from "@/lib/alpha-exchange-store";
import { hasTrustedSameOrigin } from "@/lib/request-origin";
import { shouldUseSecureAuthCookie } from "@/lib/auth-cookie";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const revokeSchema = z.object({ sessionId: z.string().regex(/^[a-f0-9]{32}$/) }).strict();

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const token = await getCurrentSessionToken();
  if (!token) return NextResponse.json({ error: "Session unavailable." }, { status: 401, headers: privateHeaders });
  try {
    return NextResponse.json({ ownerId: user.id, sessions: await listAccountSessions(user.id, token) }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: "Session storage is temporarily unavailable." }, { status: 503, headers: privateHeaders });
  }
}

export async function DELETE(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  if (!hasTrustedSameOrigin(request)) return NextResponse.json({ error: "Untrusted request origin." }, { status: 403, headers: privateHeaders });
  const rate = await checkSharedRateLimit({ headers: request.headers, key: "account:revoke-session", identifier: user.id, maxRequests: 8, windowMs: 60_000 });
  if (!rate.allowed) return createRateLimitResponse(rate.retryAfterSeconds);
  const token = await getCurrentSessionToken();
  if (!token) return NextResponse.json({ error: "Session unavailable." }, { status: 401, headers: privateHeaders });
  let parsed;
  try { parsed = revokeSchema.safeParse(await request.json()); } catch { return NextResponse.json({ error: "Invalid session identifier." }, { status: 400, headers: privateHeaders }); }
  if (!parsed.success) return NextResponse.json({ error: "Invalid session identifier." }, { status: 400, headers: privateHeaders });
  try {
    const result = await revokeAccountSession(user.id, parsed.data.sessionId, token);
    if (!result) return NextResponse.json({ error: "Session not found. Reload your sessions." }, { status: 404, headers: privateHeaders });
    const response = NextResponse.json({ ownerId: user.id, ...result }, { headers: privateHeaders });
    if (result.currentSessionRevoked) expireAuthCookies(response.cookies, shouldUseSecureAuthCookie(request));
    return response;
  } catch {
    return NextResponse.json({ error: "Revocation could not be confirmed. Reload before trying again." }, { status: 503, headers: privateHeaders });
  }
}
