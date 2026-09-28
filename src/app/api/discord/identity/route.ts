import { NextRequest, NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api-auth";
import {
  getDiscordConnection,
  unlinkDiscordIdentity,
} from "@/lib/discord/identity-repository";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { hasTrustedSameOrigin } from "@/lib/request-origin";
import { logEvent } from "@/lib/structured-logging";

const RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;

  try {
    const connection = await getDiscordConnection(user.id);
    return NextResponse.json({ connection }, { headers: RESPONSE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Discord connection status is temporarily unavailable." },
      { status: 503, headers: RESPONSE_HEADERS },
    );
  }
}
export async function DELETE(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  if (!hasTrustedSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const rate = await checkSharedRateLimit({
    headers: request.headers,
    key: `discord-unlink:${user.id}`,
    maxRequests: 5,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  logEvent("info", {
    event: "discord_identity_unlink_request",
    actorUserId: user.id,
    targetUserId: user.id,
    outcome: "success",
    metadata: { stage: "accepted" },
  });

  try {
    const unlinked = await unlinkDiscordIdentity({ platformUserId: user.id });
    if (!unlinked) {
      logEvent("warn", {
        event: "discord_identity_unlink",
        actorUserId: user.id,
        targetUserId: user.id,
        outcome: "denied",
        reason: "No Discord identity was linked to the authenticated account",
      });
      return NextResponse.json(
        {
          error: "Discord is not connected to this account. Refresh and try again.",
          code: "DISCORD_IDENTITY_NOT_LINKED",
          unlinked: false,
        },
        { status: 409, headers: RESPONSE_HEADERS },
      );
    }
    logEvent("info", {
      event: "discord_identity_unlink",
      actorUserId: user.id,
      targetUserId: user.id,
      outcome: "success",
    });
    return NextResponse.json({ unlinked: true }, { headers: RESPONSE_HEADERS });
  } catch {
    logEvent("error", {
      event: "discord_identity_unlink",
      actorUserId: user.id,
      targetUserId: user.id,
      outcome: "failed",
      reason: "Identity unlink persistence failed",
    });
    return NextResponse.json(
      { error: "Failed to disconnect Discord. Please try again." },
      { status: 503, headers: RESPONSE_HEADERS },
    );
  }
}
