import { NextRequest, NextResponse } from "next/server";

import { getCurrentSessionUser } from "@/lib/auth";
import {
  consumeDiscordOAuthState,
  DiscordIdentityConflictError,
  linkDiscordIdentity,
  recordDiscordIdentityAudit,
} from "@/lib/discord/identity-repository";
import {
  DISCORD_OAUTH_PKCE_COOKIE,
  exchangeDiscordAuthorizationCode,
  hashDiscordOAuthState,
  readDiscordOAuthConfig,
  verifyPkceChallenge,
} from "@/lib/discord/oauth";
import { logEvent } from "@/lib/structured-logging";
import { getSiteUrl } from "@/lib/site-url";

type CallbackResult =
  | "linked"
  | "already_linked"
  | "auth_required"
  | "denied"
  | "expired"
  | "failed";

function settingsResponse(
  locale: "ar" | "en",
  result: CallbackResult,
): NextResponse {
  const destination = new URL(`/${locale}/settings`, getSiteUrl());
  destination.searchParams.set("discord", result);
  destination.hash = "discord-connection";
  const response = NextResponse.redirect(destination);
  response.cookies.set(DISCORD_OAUTH_PKCE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/discord/oauth/callback",
    expires: new Date(0),
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function auditLinkFailure(
  platformUserId: string,
  detailCode: string,
  denied = false,
): Promise<void> {
  try {
    await recordDiscordIdentityAudit({
      platformUserId,
      eventType: denied ? "identity_link_denied" : "identity_link_failed",
      outcome: denied ? "degraded" : "failed",
      detailCode,
    });
  } catch {
    logEvent("error", {
      event: "discord_identity_audit",
      actorUserId: platformUserId,
      outcome: "failed",
      reason: "Persistent Discord identity audit write failed",
    });
  }
}

export async function GET(request: NextRequest) {
  const user = await getCurrentSessionUser();
  if (!user) return settingsResponse("en", "auth_required");

  const state = request.nextUrl.searchParams.get("state") ?? "";
  if (state.length < 32 || state.length > 128) {
    return settingsResponse("en", "expired");
  }

  const consumed = await consumeDiscordOAuthState({
    stateHash: hashDiscordOAuthState(state),
    platformUserId: user.id,
  });
  if (!consumed) {
    await auditLinkFailure(user.id, "oauth_state_invalid", true);
    logEvent("warn", {
      event: "discord_identity_link",
      actorUserId: user.id,
      outcome: "denied",
      reason: "OAuth state invalid, expired, replayed, or bound to another user",
    });
    return settingsResponse("en", "expired");
  }

  const verifier = request.cookies.get(DISCORD_OAUTH_PKCE_COOKIE)?.value ?? "";
  if (!verifier || !verifyPkceChallenge(verifier, consumed.codeChallenge)) {
    await auditLinkFailure(user.id, "pkce_verification_failed", true);
    logEvent("warn", {
      event: "discord_identity_link",
      actorUserId: user.id,
      outcome: "denied",
      reason: "OAuth PKCE verification failed",
    });
    return settingsResponse(consumed.locale, "expired");
  }

  const providerError = request.nextUrl.searchParams.get("error");
  const code = request.nextUrl.searchParams.get("code") ?? "";
  if (providerError || code.length < 8 || code.length > 2048) {
    await auditLinkFailure(
      user.id,
      providerError ? "oauth_denied" : "authorization_code_invalid",
      true,
    );
    return settingsResponse(consumed.locale, providerError ? "denied" : "failed");
  }

  try {
    const profile = await exchangeDiscordAuthorizationCode({
      code,
      verifier,
      config: readDiscordOAuthConfig(),
    });
    await linkDiscordIdentity({ platformUserId: user.id, profile });
    logEvent("info", {
      event: "discord_identity_link",
      actorUserId: user.id,
      targetUserId: user.id,
      outcome: "success",
      metadata: { discordUserId: profile.id },
    });
    return settingsResponse(consumed.locale, "linked");
  } catch (error) {
    const conflict = error instanceof DiscordIdentityConflictError;
    await auditLinkFailure(
      user.id,
      conflict ? "discord_identity_conflict" : "oauth_exchange_or_link_failed",
      conflict,
    );
    logEvent(conflict ? "warn" : "error", {
      event: "discord_identity_link",
      actorUserId: user.id,
      targetUserId: user.id,
      outcome: conflict ? "denied" : "failed",
      reason: conflict ? "Discord identity already linked" : "OAuth exchange or persistence failed",
    });
    return settingsResponse(
      consumed.locale,
      conflict ? "already_linked" : "failed",
    );
  }
}
