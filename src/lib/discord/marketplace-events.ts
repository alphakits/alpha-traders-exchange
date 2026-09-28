import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export type DiscordMarketplaceEventType =
  | "listing_created"
  | "listing_updated"
  | "listing_closed"
  | "trade_requested"
  | "trade_completed"
  | "seller_approved"
  | "risk_alert";

export type DiscordMarketplaceEvent = {
  type: DiscordMarketplaceEventType;
  title: string;
  message: string;
  severity?: "info" | "warning" | "critical";
  actorDisplay?: string;
  listingId?: string;
  tradeId?: string;
  sellerId?: string;
  buyerId?: string;
  amountUsdt?: number;
  currency?: string;
  href?: string;
  occurredAt?: string;
};

export const MARKETPLACE_EVENT_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

function eventColor(event: DiscordMarketplaceEvent) {
  if (event.severity === "critical") return 0xdc2626;
  if (event.severity === "warning") return 0xf59e0b;
  return 0xc9a227;
}

function webhookUrl() {
  const url = process.env.DISCORD_MARKETPLACE_WEBHOOK_URL?.trim();
  return url || null;
}

function signingSecret() {
  const secret = process.env.DISCORD_MARKETPLACE_WEBHOOK_SECRET?.trim();
  return secret || null;
}

export function buildMarketplaceEventSignature(body: string, timestamp: string) {
  const secret = signingSecret();
  if (!secret) {
    throw new Error("Missing DISCORD_MARKETPLACE_WEBHOOK_SECRET");
  }
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifyMarketplaceEventSignature(body: string, timestamp: string, signature: string) {
  const secret = signingSecret();
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(signature, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Timestamp freshness limits replay of a captured internal relay request.
 * This relay is outbound-only; it cannot mutate marketplace state.
 */
export function isMarketplaceEventTimestampFresh(
  timestamp: string,
  now = Date.now(),
) {
  const occurredAtMs = Date.parse(timestamp);
  return Number.isFinite(occurredAtMs)
    && Math.abs(now - occurredAtMs) <= MARKETPLACE_EVENT_SIGNATURE_MAX_AGE_MS;
}

export async function sendMarketplaceEventToDiscord(event: DiscordMarketplaceEvent) {
  const url = webhookUrl();
  if (!url) {
    return { ok: false as const, skipped: true as const, reason: "webhook_not_configured" as const };
  }

  const occurredAt = event.occurredAt ?? new Date().toISOString();
  const fields = [
    event.listingId ? { name: "Listing", value: event.listingId, inline: true } : null,
    event.tradeId ? { name: "Trade", value: event.tradeId, inline: true } : null,
    event.amountUsdt ? { name: "Amount", value: `${event.amountUsdt.toLocaleString("en-IL")} USDT`, inline: true } : null,
    event.currency ? { name: "Currency", value: event.currency, inline: true } : null,
    event.actorDisplay ? { name: "Actor", value: event.actorDisplay, inline: true } : null,
  ].filter(Boolean);

  const payload = {
    username: "Alpha Marketplace",
    avatar_url: process.env.DISCORD_MARKETPLACE_AVATAR_URL || undefined,
    embeds: [
      {
        title: event.title,
        description: event.message,
        color: eventColor(event),
        timestamp: occurredAt,
        url: event.href,
        footer: {
          text: `Alpha Traders | ${event.type}`,
        },
        fields,
      },
    ],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord webhook failed (${response.status}): ${text}`);
  }

  return { ok: true as const, skipped: false as const };
}
