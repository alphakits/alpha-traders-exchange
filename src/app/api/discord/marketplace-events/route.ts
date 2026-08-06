import { NextResponse } from "next/server";

import {
  sendMarketplaceEventToDiscord,
  verifyMarketplaceEventSignature,
  type DiscordMarketplaceEvent,
} from "@/lib/discord/marketplace-events";

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

  if (timestamp && signature) {
    const signatureValid = verifyMarketplaceEventSignature(body, timestamp, signature);
    if (!signatureValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
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
    const message = error instanceof Error ? error.message : "Discord webhook dispatch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
