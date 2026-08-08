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

import {
  isSafeDiscordLinkUrl,
  resolveDiscordPublicSiteUrl,
} from "@/lib/discord/listing-publisher";

export const DISCORD_MARKET_BRAND_COLOR = 0xc9a227;
const MARKET_CONTENT_MARKER = "Alpha Traders • Managed market intelligence";

export type DiscordMarketPulseSnapshot = {
  kind: "live_market_pulse";
  generatedAt: string;
  approvedPublicSellers: number;
  activeEligibleListings: number;
  totalAvailableUsdt: number;
  averageResponseMinutes: number | null;
  activeTrades: number;
  sellersOnline: number;
  buyersOnline: number;
  siteUrl: string;
};

export type DiscordMarketActivitySnapshot = {
  kind: "market_activity_digest";
  generatedAt: string;
  windowStartedAt: string;
  approvedListingsAdded: number;
  completedTrades: number;
  newlyApprovedSellers: number;
  siteUrl: string;
};

export type DiscordLeaderboardEntry = {
  displayName: string;
  completedTrades: number;
  trustScore: number | null;
  rating: number | null;
};

export type DiscordWeeklyLeaderboardSnapshot = {
  kind: "weekly_top_sellers";
  generatedAt: string;
  windowStartedAt: string;
  windowEndsAt: string;
  timeZoneLabel: "UTC";
  entries: DiscordLeaderboardEntry[];
  siteUrl: string;
};

export type DiscordMarketContentSnapshot =
  | DiscordMarketPulseSnapshot
  | DiscordMarketActivitySnapshot
  | DiscordWeeklyLeaderboardSnapshot;

export interface DiscordMarketContentPublisher {
  createMessage(input: {
    channelId: string;
    nonce: string;
    snapshot: DiscordMarketContentSnapshot;
  }): Promise<string>;
  findOwnedMessage(input: {
    channelId: string;
    nonce: string;
  }): Promise<string | null>;
  ownsMessage(input: {
    channelId: string;
    messageId: string;
    nonce: string;
  }): Promise<boolean>;
  updateMessage(input: {
    channelId: string;
    messageId: string;
    snapshot: DiscordMarketContentSnapshot;
  }): Promise<void>;
}

function formatInteger(value: number): string {
  return Math.max(0, value).toLocaleString("en-IL");
}

function formatUsdt(value: number): string {
  return `${Math.max(0, value).toLocaleString("en-IL", {
    maximumFractionDigits: 2,
  })} USDT`;
}

export function escapeDiscordPlainText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/([\\`*_{}[\]()<>#+\-.!|~])/g, "\\$1")
    .replace(/https?:\/\//gi, "")
    .replace(/@/g, "@\u200b")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function pulseMessage(
  snapshot: DiscordMarketPulseSnapshot,
): RESTPostAPIChannelMessageJSONBody {
  const fields = [
    {
      name: "Approved public sellers",
      value: formatInteger(snapshot.approvedPublicSellers),
      inline: true,
    },
    {
      name: "Active eligible listings",
      value: formatInteger(snapshot.activeEligibleListings),
      inline: true,
    },
    {
      name: "Available liquidity",
      value: formatUsdt(snapshot.totalAvailableUsdt),
      inline: true,
    },
    {
      name: "Active trades",
      value: formatInteger(snapshot.activeTrades),
      inline: true,
    },
    {
      name: "Sellers online",
      value: formatInteger(snapshot.sellersOnline),
      inline: true,
    },
    {
      name: "Buyers online",
      value: formatInteger(snapshot.buyersOnline),
      inline: true,
    },
    ...(snapshot.averageResponseMinutes === null
      ? []
      : [{
          name: "Measured listing response",
          value: `~${formatInteger(snapshot.averageResponseMinutes)} min`,
          inline: true,
        }]),
  ];
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: "LIVE MARKET PULSE",
      description: "Authoritative Alpha Traders marketplace totals, refreshed in place.",
      color: DISCORD_MARKET_BRAND_COLOR,
      url: `${snapshot.siteUrl}/en/usdt-exchange`,
      fields,
      footer: {
        text: `${MARKET_CONTENT_MARKER} • Server clock ${snapshot.generatedAt}`,
      },
    }],
  };
}

function activityMessage(
  snapshot: DiscordMarketActivitySnapshot,
): RESTPostAPIChannelMessageJSONBody {
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: "MARKET ACTIVITY • 24H DIGEST",
      description: "Privacy-safe lifecycle totals. Individual buyers, trades, and amounts are never shown.",
      color: DISCORD_MARKET_BRAND_COLOR,
      fields: [
        {
          name: "Approved listings added",
          value: formatInteger(snapshot.approvedListingsAdded),
          inline: true,
        },
        {
          name: "Trades completed",
          value: formatInteger(snapshot.completedTrades),
          inline: true,
        },
        {
          name: "Sellers approved",
          value: formatInteger(snapshot.newlyApprovedSellers),
          inline: true,
        },
      ],
      footer: {
        text: `${MARKET_CONTENT_MARKER} • ${snapshot.windowStartedAt} to ${snapshot.generatedAt}`,
      },
    }],
  };
}

function leaderboardMessage(
  snapshot: DiscordWeeklyLeaderboardSnapshot,
): RESTPostAPIChannelMessageJSONBody {
  const description = snapshot.entries.length === 0
    ? "No public approved seller completed a qualifying trade in the current UTC week."
    : snapshot.entries.map((entry, index) => {
        const details = [
          `${entry.completedTrades} completed`,
          entry.trustScore === null ? null : `${entry.trustScore.toFixed(1)} trust`,
          entry.rating === null ? null : `${entry.rating.toFixed(2)}★`,
        ].filter(Boolean).join(" • ");
        return `**${index + 1}. ${escapeDiscordPlainText(entry.displayName)}**\n${details}`;
      }).join("\n\n");
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: "WEEKLY TOP SELLERS",
      description,
      color: DISCORD_MARKET_BRAND_COLOR,
      footer: {
        text: `${MARKET_CONTENT_MARKER} • ${snapshot.windowStartedAt} to ${snapshot.windowEndsAt} ${snapshot.timeZoneLabel}`,
      },
    }],
  };
}

export function buildDiscordMarketContentMessage(
  snapshot: DiscordMarketContentSnapshot,
): RESTPostAPIChannelMessageJSONBody {
  if (snapshot.kind === "live_market_pulse") return pulseMessage(snapshot);
  if (snapshot.kind === "market_activity_digest") return activityMessage(snapshot);
  return leaderboardMessage(snapshot);
}

export function hashDiscordMarketContentSnapshot(
  snapshot: DiscordMarketContentSnapshot,
): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function isUnknownMessage(error: unknown): boolean {
  return error instanceof DiscordAPIError && error.code === 10008;
}

function hasExpectedNonce(
  message: RESTGetAPIChannelMessageResult,
  nonce: string,
): boolean {
  return String(message.nonce ?? "") === nonce.slice(0, 25);
}

function isRecoverableOwnedMessage(
  message: RESTGetAPIChannelMessageResult,
  nonce: string,
): boolean {
  return hasExpectedNonce(message, nonce)
    && message.embeds.some((embed) =>
      embed.footer?.text?.startsWith(MARKET_CONTENT_MARKER));
}

export class DiscordRestMarketContentPublisher
implements DiscordMarketContentPublisher {
  private readonly rest: REST;

  constructor(token: string, rest?: REST) {
    this.rest = rest ?? new REST({ version: "10" }).setToken(token);
  }

  async createMessage(input: {
    channelId: string;
    nonce: string;
    snapshot: DiscordMarketContentSnapshot;
  }): Promise<string> {
    const result = await this.rest.post(
      Routes.channelMessages(input.channelId),
      {
        body: {
          ...buildDiscordMarketContentMessage(input.snapshot),
          nonce: input.nonce.slice(0, 25),
          enforce_nonce: true,
        },
      },
    ) as RESTGetAPIChannelMessageResult;
    return result.id;
  }

  async findOwnedMessage(input: {
    channelId: string;
    nonce: string;
  }): Promise<string | null> {
    const messages = await this.rest.get(
      Routes.channelMessages(input.channelId),
      { query: new URLSearchParams({ limit: "100" }) },
    ) as RESTGetAPIChannelMessagesResult;
    return messages.find((message) =>
      isRecoverableOwnedMessage(message, input.nonce))?.id ?? null;
  }

  async ownsMessage(input: {
    channelId: string;
    messageId: string;
    nonce: string;
  }): Promise<boolean> {
    try {
      const message = await this.rest.get(
        Routes.channelMessage(input.channelId, input.messageId),
      ) as RESTGetAPIChannelMessageResult;
      return hasExpectedNonce(message, input.nonce);
    } catch (error) {
      if (isUnknownMessage(error)) return false;
      throw error;
    }
  }

  async updateMessage(input: {
    channelId: string;
    messageId: string;
    snapshot: DiscordMarketContentSnapshot;
  }): Promise<void> {
    await this.rest.patch(
      Routes.channelMessage(input.channelId, input.messageId),
      { body: buildDiscordMarketContentMessage(input.snapshot) },
    );
  }
}

export function normalizeMarketSiteUrl(value: string): string {
  const siteUrl = resolveDiscordPublicSiteUrl(value);
  return isSafeDiscordLinkUrl(siteUrl)
    ? siteUrl
    : "https://www.alphatraders.co.il";
}
