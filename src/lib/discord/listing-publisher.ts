import "server-only";

import { createHash } from "node:crypto";

import {
  DiscordAPIError,
  REST,
  Routes,
  type RESTGetAPIChannelMessageResult,
  type RESTGetAPIChannelMessagesResult,
  type RESTPostAPIChannelMessageJSONBody,
} from "discord.js";

export const DISCORD_LISTING_BRAND_COLOR = 0xc9a227;

export type DiscordListingSnapshot = {
  sellerDisplayName: string;
  sellerLevel: string | null;
  reliabilityTier: string | null;
  approvedSeller: boolean;
  availableAmount: string;
  price: string;
  currency: string;
  network: string;
  paymentMethods: string[];
  presenceLabel: string;
  responseTimeMinutes: number | null;
  imageUrl: string;
  listingUrl: string;
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

function normalizeDecimal(value: string): string {
  const parsed = Number(String(value).replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-IL", { maximumFractionDigits: 2 }) : "0";
}

function levelLabel(level: string | null): string | null {
  if (!level) return null;
  return `${level[0]?.toUpperCase()}${level.slice(1).toLowerCase()} Seller`;
}

export function isSafeDiscordImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.username === ""
      && parsed.password === ""
      && !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
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
    snapshot.reliabilityTier,
    snapshot.approvedSeller ? "✓ Approved Seller" : null,
  ].filter(Boolean).join(" • ");
  const fields = [
    {
      name: sold ? "Last available amount" : "Available",
      value: sold ? `${normalizeDecimal(snapshot.availableAmount)} USDT` : `**${normalizeDecimal(snapshot.availableAmount)} USDT**`,
      inline: true,
    },
    {
      name: "Price",
      value: `**₪${normalizeDecimal(snapshot.price)} / USDT**`,
      inline: true,
    },
    {
      name: "Network",
      value: snapshot.network,
      inline: true,
    },
    {
      name: "Payment",
      value: snapshot.paymentMethods.join(" • "),
      inline: false,
    },
    {
      name: "Seller availability",
      value: snapshot.presenceLabel,
      inline: true,
    },
    ...(snapshot.responseTimeMinutes
      ? [{
          name: "Measured response",
          value: `~${snapshot.responseTimeMinutes} min`,
          inline: true,
        }]
      : []),
  ];

  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: sold ? "SOLD • USDT listing completed" : `${normalizeDecimal(snapshot.availableAmount)} USDT available`,
        description: sellerMeta || "Alpha Traders marketplace seller",
        color: sold ? 0x6b7280 : DISCORD_LISTING_BRAND_COLOR,
        url: snapshot.listingUrl,
        author: {
          name: snapshot.sellerDisplayName,
        },
        thumbnail: {
          url: snapshot.imageUrl,
        },
        fields,
        footer: {
          text: sold
            ? "Alpha Traders • Historical sold listing"
            : "Alpha Traders • Trusted marketplace listing",
          icon_url: snapshot.imageUrl,
        },
      },
    ],
    components: sold
      ? []
      : [
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: "View Listing",
                url: snapshot.listingUrl,
              },
            ],
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
