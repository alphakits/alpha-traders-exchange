import "server-only";

import type { RESTPostAPIChannelMessageJSONBody } from "discord.js";

import {
  DISCORD_MARKET_BRAND_COLOR,
  normalizeMarketSiteUrl,
} from "@/lib/discord/market-intelligence-publisher";
import { escapeDiscordPlainText } from "@/lib/discord/message-safety";
import {
  isSafeDiscordImageUrl,
  isSafeDiscordLinkUrl,
} from "@/lib/discord/listing-publisher";

export type DiscordPublicSellerProfile = {
  displayName: string;
  level: string | null;
  rating: number | null;
  reliabilityScore: number | null;
  completedTrades: number | null;
  publicVolumeRange: string | null;
  memberSince: string;
  presenceLabel: string | null;
  responseTimeMinutes: number | null;
  profileUrl: string;
  imageUrl: string | null;
  siteUrl: string;
};

function formatLevel(level: string): string {
  return `${level.charAt(0).toUpperCase()}${level.slice(1).toLowerCase()} Seller`;
}

export function buildDiscordSellerProfileCard(
  profile: DiscordPublicSellerProfile,
): RESTPostAPIChannelMessageJSONBody {
  const siteUrl = normalizeMarketSiteUrl(profile.siteUrl);
  const profileUrl = isSafeDiscordLinkUrl(profile.profileUrl)
    && new URL(profile.profileUrl).origin === siteUrl
    ? profile.profileUrl
    : siteUrl;
  const fields = [
    ...(profile.level
      ? [{
          name: "Level",
          value: escapeDiscordPlainText(formatLevel(profile.level)),
          inline: true,
        }]
      : []),
    ...(profile.rating === null
      ? []
      : [{ name: "Rating", value: `${profile.rating.toFixed(2)} / 5`, inline: true }]),
    ...(profile.reliabilityScore === null
      ? []
      : [{
          name: "Reliability",
          value: `${profile.reliabilityScore.toFixed(0)} / 100`,
          inline: true,
        }]),
    ...(profile.completedTrades === null
      ? []
      : [{
          name: "Completed trades",
          value: profile.completedTrades.toLocaleString("en-IL"),
          inline: true,
        }]),
    ...(profile.publicVolumeRange
      ? [{
          name: "Public volume",
          value: escapeDiscordPlainText(profile.publicVolumeRange),
          inline: true,
        }]
      : []),
    {
      name: "Member since",
      value: new Date(profile.memberSince).toLocaleDateString("en-IL", {
        timeZone: "UTC",
        year: "numeric",
        month: "short",
      }),
      inline: true,
    },
    ...(profile.presenceLabel
      ? [{
          name: "Presence",
          value: escapeDiscordPlainText(profile.presenceLabel),
          inline: true,
        }]
      : []),
    ...(profile.responseTimeMinutes === null
      ? []
      : [{
          name: "Measured response",
          value: `~${profile.responseTimeMinutes.toLocaleString("en-IL")} min`,
          inline: true,
        }]),
  ];
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: escapeDiscordPlainText(profile.displayName),
      description: "Verified public Alpha Traders seller profile.",
      color: DISCORD_MARKET_BRAND_COLOR,
      url: profileUrl,
      fields,
      ...(isSafeDiscordImageUrl(profile.imageUrl)
        ? { thumbnail: { url: profile.imageUrl } }
        : {}),
      footer: {
        text: "Alpha Traders • Public seller profile",
      },
    }],
    components: profileUrl === siteUrl
      ? []
      : [{
          type: 1,
          components: [{
            type: 2,
            style: 5,
            label: "View Public Profile",
            url: profileUrl,
          }],
        }],
  };
}
