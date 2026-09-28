import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";

import {
  DiscordAPIError,
  REST,
  Routes,
  type RESTGetAPIChannelMessageResult,
  type RESTGetAPIChannelMessagesResult,
  type RESTPostAPIChannelMessageJSONBody,
} from "discord.js";
import { escapeDiscordPlainText } from "@/lib/discord/message-safety";

export const DISCORD_LISTING_BRAND_COLOR = 0xc9a227;
export const DISCORD_LISTING_SOLD_COLOR = 0x6b7280;
const DEFAULT_PUBLIC_SITE_URL = "https://www.alphatraders.co.il";

export type DiscordListingSnapshot = {
  snapshotVersion?: 2;
  sellerDisplayName: string;
  sellerLevel: string | null;
  reliabilityTier: string | null;
  approvedSeller: boolean;
  availableAmount: string;
  price: string;
  currency: string;
  network: string;
  paymentMethods: string[];
  presenceLabel: string | null;
  responseTimeMinutes: number | null;
  rating?: number | null;
  completedTrades?: number | null;
  imageUrl: string;
  brandImageUrl?: string;
  listingUrl: string;
  sellerProfileUrl?: string | null;
  websiteUrl?: string;
};

export interface DiscordListingPublisher {
  createMessage(input: {
    channelId: string;
    nonce: string;
    snapshot: DiscordListingSnapshot;
  }): Promise<string>;
  updateMessage(input: {
    channelId: string;
    messageId: string;
    snapshot: DiscordListingSnapshot;
    sold: boolean;
  }): Promise<void>;
  deleteMessage(input: { channelId: string; messageId: string }): Promise<void>;
  messageExists(input: { channelId: string; messageId: string }): Promise<boolean>;
  findMessageByNonce(input: { channelId: string; nonce: string }): Promise<string | null>;
}

function normalizeDecimal(value: string, minimumFractionDigits = 0): string {
  const parsed = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed)
    ? parsed.toLocaleString("en-IL", { minimumFractionDigits, maximumFractionDigits: 2 })
    : minimumFractionDigits > 0 ? "0.00" : "0";
}

function levelLabel(level: string | null): string | null {
  if (!level) return null;
  return escapeDiscordPlainText(
    `${level[0]?.toUpperCase()}${level.slice(1).toLowerCase()} Seller`,
  );
}

function isPrivateOrReservedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
  ) {
    return true;
  }
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const [first, second] = normalized.split(".").map(Number);
    return first === 0
      || first === 10
      || first === 127
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 198 && (second === 18 || second === 19))
      || first >= 224;
  }
  if (ipVersion === 6) {
    return normalized === "::"
      || normalized === "::1"
      || normalized.startsWith("::ffff:")
      || normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith("ff");
  }
  return false;
}

function containsSensitiveIdentifier(value: string): boolean {
  const decoded = decodeURIComponent(value);
  return /(?:^|[^a-z0-9])[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}(?:$|[^a-z0-9])/i.test(decoded)
    || /0x[a-f0-9]{32,}/i.test(decoded)
    || /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(decoded);
}

export function isSafeDiscordImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.username === ""
      && parsed.password === ""
      && parsed.search === ""
      && parsed.hash === ""
      && !containsSensitiveIdentifier(parsed.pathname)
      && !isPrivateOrReservedHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function isSafeDiscordLinkUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.username === ""
      && parsed.password === ""
      && parsed.search === ""
      && parsed.hash === ""
      && !isPrivateOrReservedHostname(parsed.hostname)
      && !containsSensitiveIdentifier(parsed.pathname);
  } catch {
    return false;
  }
}

export function resolveDiscordPublicSiteUrl(value: unknown): string {
  if (!isSafeDiscordLinkUrl(value)) return DEFAULT_PUBLIC_SITE_URL;
  return new URL(value).origin;
}

export function hashDiscordListingSnapshot(snapshot: DiscordListingSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function buildDiscordListingMessage(
  snapshot: DiscordListingSnapshot,
  sold = false,
): RESTPostAPIChannelMessageJSONBody {
  const sellerMeta = [
    levelLabel(snapshot.sellerLevel),
    snapshot.reliabilityTier
      ? escapeDiscordPlainText(snapshot.reliabilityTier)
      : null,
    snapshot.approvedSeller ? "✅ Approved Seller" : null,
  ].filter(Boolean).join(" • ");
  const fields = [
    {
      name: sold ? "Last available amount" : "Available USDT",
      value: sold
        ? `${normalizeDecimal(snapshot.availableAmount)} USDT`
        : `**${normalizeDecimal(snapshot.availableAmount)} USDT**`,
      inline: true,
    },
    {
      name: "Price per USDT",
      value: `**₪${normalizeDecimal(snapshot.price, 2)}**`,
      inline: true,
    },
    {
      name: "Network",
      value: escapeDiscordPlainText(snapshot.network),
      inline: true,
    },
    ...(snapshot.paymentMethods.length
      ? [{
          name: "Payment methods",
          value: snapshot.paymentMethods
            .map(escapeDiscordPlainText)
            .join(" • "),
          inline: false,
        }]
      : []),
    ...(snapshot.presenceLabel
      ? [{
          name: "Availability",
          value: escapeDiscordPlainText(snapshot.presenceLabel),
          inline: true,
        }]
      : []),
    ...(snapshot.responseTimeMinutes
      ? [{
          name: "Measured response",
          value: `~${snapshot.responseTimeMinutes} min`,
          inline: true,
        }]
      : []),
    ...(snapshot.rating
      ? [{
          name: "Seller rating",
          value: `⭐ ${snapshot.rating.toFixed(2)} / 5`,
          inline: true,
        }]
      : []),
    ...(snapshot.completedTrades
      ? [{
          name: "Completed trades",
          value: snapshot.completedTrades.toLocaleString("en-IL"),
          inline: true,
        }]
      : []),
  ];
  const websiteUrl = isSafeDiscordLinkUrl(snapshot.websiteUrl)
    ? snapshot.websiteUrl
    : isSafeDiscordLinkUrl(snapshot.listingUrl)
      ? new URL(snapshot.listingUrl).origin
      : DEFAULT_PUBLIC_SITE_URL;
  const brandImageUrl = isSafeDiscordImageUrl(snapshot.brandImageUrl)
    ? snapshot.brandImageUrl
    : `${websiteUrl}/images/brand/alpha-traders-logo.png`;
  const sellerImageUrl = isSafeDiscordImageUrl(snapshot.imageUrl)
    ? snapshot.imageUrl
    : brandImageUrl;
  const activeButtons = [
    isSafeDiscordLinkUrl(snapshot.listingUrl)
      ? { type: 2 as const, style: 5 as const, label: "View Marketplace", url: snapshot.listingUrl }
      : null,
    isSafeDiscordLinkUrl(snapshot.sellerProfileUrl)
      ? { type: 2 as const, style: 5 as const, label: "Seller Profile", url: snapshot.sellerProfileUrl }
      : null,
    isSafeDiscordLinkUrl(websiteUrl)
      ? { type: 2 as const, style: 5 as const, label: "Website", url: websiteUrl }
      : null,
  ].filter((button): button is NonNullable<typeof button> => Boolean(button));

  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: sold ? "✅ SOLD" : "🔥 NEW USDT LISTING",
        description: sold
          ? `This listing is complete. Historical details below reflect the last active Alpha Traders post.\n\n**Seller:** ${escapeDiscordPlainText(snapshot.sellerDisplayName)}${sellerMeta ? `\n${sellerMeta}` : ""}`
          : `**${escapeDiscordPlainText(snapshot.sellerDisplayName)}**${sellerMeta ? `\n${sellerMeta}` : ""}`,
        color: sold ? DISCORD_LISTING_SOLD_COLOR : DISCORD_LISTING_BRAND_COLOR,
        url: !sold && isSafeDiscordLinkUrl(snapshot.listingUrl) ? snapshot.listingUrl : undefined,
        author: {
          name: "Alpha Traders Marketplace",
          icon_url: brandImageUrl,
          url: websiteUrl,
        },
        thumbnail: {
          url: sellerImageUrl,
        },
        fields,
        footer: {
          text: sold
            ? "Alpha Traders • Completed listing history"
            : "Alpha Traders • Premium USDT marketplace",
          icon_url: brandImageUrl,
        },
      },
    ],
    components: sold || activeButtons.length === 0
      ? []
      : [
          {
            type: 1,
            components: activeButtons,
          },
        ],
  };
}

function isUnknownMessage(error: unknown): boolean {
  return error instanceof DiscordAPIError && error.code === 10008;
}

export class DiscordRestListingPublisher implements DiscordListingPublisher {
  private readonly rest: REST;

  constructor(token: string) {
    this.rest = new REST({ version: "10" }).setToken(token);
  }

  async createMessage(input: {
    channelId: string;
    nonce: string;
    snapshot: DiscordListingSnapshot;
  }): Promise<string> {
    const result = await this.rest.post(
      Routes.channelMessages(input.channelId),
      {
        body: {
          ...buildDiscordListingMessage(input.snapshot),
          nonce: input.nonce.slice(0, 25),
          enforce_nonce: true,
        },
      },
    ) as RESTGetAPIChannelMessageResult;
    return result.id;
  }

  async findMessageByNonce(input: {
    channelId: string;
    nonce: string;
  }): Promise<string | null> {
    const nonce = input.nonce.slice(0, 25);
    const messages = await this.rest.get(
      Routes.channelMessages(input.channelId),
      { query: new URLSearchParams({ limit: "100" }) },
    ) as RESTGetAPIChannelMessagesResult;
    const recovered = messages.find((message) =>
      String(message.nonce ?? "") === nonce
      && message.embeds.some((embed) =>
        embed.footer?.text?.startsWith("Alpha Traders •"),
      ),
    );
    return recovered?.id ?? null;
  }

  async updateMessage(input: {
    channelId: string;
    messageId: string;
    snapshot: DiscordListingSnapshot;
    sold: boolean;
  }): Promise<void> {
    await this.rest.patch(
      Routes.channelMessage(input.channelId, input.messageId),
      { body: buildDiscordListingMessage(input.snapshot, input.sold) },
    );
  }

  async deleteMessage(input: { channelId: string; messageId: string }): Promise<void> {
    try {
      await this.rest.delete(Routes.channelMessage(input.channelId, input.messageId));
    } catch (error) {
      if (!isUnknownMessage(error)) throw error;
    }
  }

  async messageExists(input: { channelId: string; messageId: string }): Promise<boolean> {
    try {
      await this.rest.get(Routes.channelMessage(input.channelId, input.messageId));
      return true;
    } catch (error) {
      if (isUnknownMessage(error)) return false;
      throw error;
    }
  }
}
