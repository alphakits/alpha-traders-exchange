import { NextResponse } from "next/server";

import {
  isMarketplaceEventTimestampFresh,
  sendMarketplaceEventToDiscord,
  verifyMarketplaceEventSignature,
  type DiscordMarketplaceEvent,
} from "@/lib/discord/marketplace-events";
import { isProductionSecurityRuntime } from "@/lib/runtime-safety";
import { logEvent } from "@/lib/structured-logging";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function isEventType(value: unknown): value is DiscordMarketplaceEvent["type"] {
  return (
    value === "listing_created"
    || value === "listing_updated"
    || value === "listing_closed"
    || value === "trade_requested"
    || value === "trade_completed"
    || value === "seller_approved"
    || value === "risk_alert"
  );
}

function parseEvent(payload: unknown): DiscordMarketplaceEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const event = payload as Record<string, unknown>;

  if (!isEventType(event.type)) return null;
  if (typeof event.title !== "string" || !event.title.trim()) return null;
  if (typeof event.message !== "string" || !event.message.trim()) return null;

  return {
    type: event.type,
    title: event.title,
    message: event.message,
    severity: event.severity === "warning" || event.severity === "critical" ? event.severity : "info",
    actorDisplay: typeof event.actorDisplay === "string" ? event.actorDisplay : undefined,
    listingId: typeof event.listingId === "string" ? event.listingId : undefined,
    tradeId: typeof event.tradeId === "string" ? event.tradeId : undefined,
    sellerId: typeof event.sellerId === "string" ? event.sellerId : undefined,
    buyerId: typeof event.buyerId === "string" ? event.buyerId : undefined,
    amountUsdt: typeof event.amountUsdt === "number" ? event.amountUsdt : undefined,
    currency: typeof event.currency === "string" ? event.currency : undefined,
    href: typeof event.href === "string" ? event.href : undefined,
    occurredAt: typeof event.occurredAt === "string" ? event.occurredAt : undefined,
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.DISCORD_MARKETPLACE_API_KEY;
  const requestKey = request.headers.get("x-alpha-discord-key")?.trim();

  if (!apiKey || !requestKey || apiKey !== requestKey) {
    return unauthorized();
  }

  const body = await request.text();

  const timestamp = request.headers.get("x-alpha-signature-timestamp")?.trim();
  const signature = request.headers.get("x-alpha-signature")?.trim();
  const signatureSupplied = Boolean(timestamp || signature);
  const signatureRequired = isProductionSecurityRuntime();

  if (signatureRequired && (!timestamp || !signature)) {
    return unauthorized();
  }

  if (signatureSupplied) {
    const signatureValid = typeof timestamp === "string"
      && typeof signature === "string"
      && isMarketplaceEventTimestampFresh(timestamp)
      && verifyMarketplaceEventSignature(body, timestamp, signature);
    if (!signatureValid) return unauthorized();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const event = parseEvent(parsed);
  if (!event) {
    return NextResponse.json({ error: "Invalid event payload" }, { status: 422 });
  }

  try {
    const result = await sendMarketplaceEventToDiscord(event);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    logEvent("error", {
      event: "discord_marketplace_event_relay",
      outcome: "failed",
      reason: "webhook_dispatch_failed",
      metadata: {
        eventType: event.type,
        errorType: error instanceof Error ? error.name : typeof error,
      },
    });
    return NextResponse.json({ error: "Discord webhook dispatch failed" }, { status: 502 });
  }
}
