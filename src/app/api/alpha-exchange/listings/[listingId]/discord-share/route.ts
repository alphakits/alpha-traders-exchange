import { NextRequest, NextResponse } from "next/server";

import { requireApiSellerWorkspaceActor } from "@/lib/api-auth";
import { getSellerMarketplaceEnforcementStatus } from "@/lib/alpha-exchange-store";
import {
  claimDiscordListingShare,
  DiscordListingShareError,
} from "@/lib/discord/listing-share-repository";
import { checkRateLimit } from "@/lib/rate-limit";
import { hasTrustedSameOrigin } from "@/lib/request-origin";
import { logEvent } from "@/lib/structured-logging";

type RouteContext = {
  params: Promise<{ listingId: string }>;
};

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiSellerWorkspaceActor();
  if (!user) return unauthorized;
  const enforcement = await getSellerMarketplaceEnforcementStatus(user.id);
  if (enforcement.restricted) {
    return NextResponse.json(
      {
        error: enforcement.blockReason ?? "Marketplace restriction active.",
        code: "MARKETPLACE_RESTRICTION_ACTIVE",
        enforcement,
      },
      { status: 403 },
    );
  }
  if (!hasTrustedSameOrigin(request)) {
    return NextResponse.json(
      { error: "Invalid request origin.", code: "INVALID_ORIGIN" },
      { status: 403 },
    );
  }

  const rate = checkRateLimit({
    headers: request.headers,
    key: `discord-listing-share:${user.id}`,
    maxRequests: 12,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many share requests. Please try again shortly.", code: "RATE_LIMITED" },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  const { listingId } = await context.params;
  let body: { requestKey?: unknown };
  try {
    body = await request.json() as { requestKey?: unknown };
  } catch {
    return NextResponse.json(
      { error: "Invalid share request.", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  try {
    const result = await claimDiscordListingShare({
      sellerId: user.id,
      listingId,
      requestKey: String(body.requestKey ?? ""),
    });
    logEvent("info", {
      event: "discord_listing_share_request",
      actorUserId: user.id,
      targetUserId: user.id,
      outcome: "success",
      metadata: {
        accepted: result.accepted,
        mappingId: result.mappingId,
      },
    });
    return NextResponse.json(result, {
      status: result.accepted ? 202 : 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    if (error instanceof DiscordListingShareError) {
      logEvent(error.status >= 500 ? "error" : "warn", {
        event: "discord_listing_share_request",
        actorUserId: user.id,
        targetUserId: user.id,
        outcome: error.status >= 500 ? "failed" : "denied",
        reason: error.code,
      });
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          sharing: error.sharing,
        },
        {
          status: error.status,
          headers: { "Cache-Control": "no-store, max-age=0" },
        },
      );
    }
    logEvent("error", {
      event: "discord_listing_share_request",
      actorUserId: user.id,
      targetUserId: user.id,
      outcome: "failed",
      reason: "unexpected_failure",
    });
    return NextResponse.json(
      {
        error: "Discord listing sharing is temporarily unavailable.",
        code: "SHARING_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}
