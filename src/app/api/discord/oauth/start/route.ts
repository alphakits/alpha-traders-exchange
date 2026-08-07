import { NextRequest, NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import {
  createDiscordOAuthStateRecord,
} from "@/lib/discord/identity-repository";
import {
  createDiscordOAuthState,
  DISCORD_OAUTH_PKCE_COOKIE,
  readDiscordOAuthConfig,
} from "@/lib/discord/oauth";
import { checkRateLimit } from "@/lib/rate-limit";
import { hasTrustedSameOrigin } from "@/lib/request-origin";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  if (!hasTrustedSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const rate = checkRateLimit({
    headers: request.headers,
    key: `discord-oauth-start:${user.id}`,
    maxRequests: 5,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many connection attempts. Please try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  try {
    const body = await request.json() as { locale?: unknown };
    const locale = body.locale === "ar" ? "ar" : "en";
    const config = readDiscordOAuthConfig();
    const oauth = createDiscordOAuthState(config);
    await createDiscordOAuthStateRecord({
      stateHash: oauth.stateHash,
      platformUserId: user.id,
      codeChallenge: oauth.challenge,
      locale,
      expiresAt: oauth.expiresAt,
    });

    const response = NextResponse.json({ authorizationUrl: oauth.authorizationUrl });
    response.cookies.set(DISCORD_OAUTH_PKCE_COOKIE, oauth.verifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/discord/oauth/callback",
      expires: oauth.expiresAt,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json(
      { error: "Discord connection is not available yet." },
      { status: 503 },
    );
  }
}
