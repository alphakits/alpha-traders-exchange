import "server-only";

import { createHash } from "node:crypto";

import type { RESTPostAPIChannelMessageJSONBody } from "discord.js";

import {
  ALLOWED_LISTING_EXPIRATION_HOURS,
  COMMISSION_GRACE_PERIOD_DAYS,
  COMMISSION_RATE,
  MAX_ACTIVE_LISTINGS_PER_SELLER,
} from "@/lib/marketplace-policy";
import { SELLER_PRESTIGE_TIERS } from "@/lib/seller-prestige";
import { getOfficialOwnerWhatsAppUrl } from "@/lib/official-contact";
import {
  DISCORD_MARKET_BRAND_COLOR,
  normalizeMarketSiteUrl,
} from "@/lib/discord/market-intelligence-publisher";

export const DISCORD_ONBOARDING_CONTENT_KEYS = [
  "welcome",
  "how_alpha_exchange_works",
  "buyer_guide",
  "become_a_seller",
  "seller_ranks_public",
  "seller_rules_public",
  "support",
  "contact_owner",
  "seller_dashboard_help",
  "seller_ranks",
  "seller_rules",
] as const;

export type DiscordOnboardingContentKey =
  (typeof DISCORD_ONBOARDING_CONTENT_KEYS)[number];

export const DISCORD_ONBOARDING_RESOURCE_BY_CONTENT = {
  welcome: "onboarding_welcome",
  how_alpha_exchange_works: "how_alpha_exchange_works",
  buyer_guide: "buyer_guide",
  become_a_seller: "become_a_seller",
  seller_ranks_public: "seller_ranks_public",
  seller_rules_public: "seller_rules_public",
  support: "onboarding_support",
  contact_owner: "contact_owner",
  seller_dashboard_help: "seller_guides",
  seller_ranks: "seller_ranks",
  seller_rules: "seller_rules",
} as const;

export const DISCORD_ONBOARDING_CONTENT_MARKER =
  "Alpha Traders • Managed onboarding";

function linkButton(label: string, url: string) {
  return { type: 2 as const, style: 5 as const, label, url };
}

function actionRow(...components: ReturnType<typeof linkButton>[]) {
  return { type: 1 as const, components };
}

function baseEmbed(title: string, description: string) {
  return {
    title,
    description,
    color: DISCORD_MARKET_BRAND_COLOR,
    footer: { text: DISCORD_ONBOARDING_CONTENT_MARKER },
  };
}

function rankFields() {
  return SELLER_PRESTIGE_TIERS.map((tier) => ({
    name: `${tier.rank.charAt(0).toUpperCase()}${tier.rank.slice(1)}`,
    value: `${tier.minVolumeUsdt.toLocaleString("en-IL")} USDT lifetime completed volume`,
    inline: true,
  }));
}

function rulesFields() {
  return [{
    name: "Listings",
    value: `Up to ${MAX_ACTIVE_LISTINGS_PER_SELLER} active listings. Expiration options: ${ALLOWED_LISTING_EXPIRATION_HOURS.join(", ")} hours.`,
  }, {
    name: "Commission",
    value: `${COMMISSION_RATE * 100}% of completed trade USDT volume, with the current ${COMMISSION_GRACE_PERIOD_DAYS}-day grace period. Pending commission blocks new or renewed listings.`,
  }, {
    name: "Vacation and restrictions",
    value: "Vacation Mode hides the seller from new buyer requests. Suspension and marketplace restrictions remain website-controlled.",
  }, {
    name: "Privacy and safety",
    value: "Keep buyer information, payments, wallets, evidence, identity documents, and every trade step on Alpha Exchange—not in Discord.",
  }];
}

export function buildDiscordOnboardingContent(input: {
  key: DiscordOnboardingContentKey;
  siteUrl: string;
  ownerWhatsAppUrl?: string | null;
}): RESTPostAPIChannelMessageJSONBody {
  const siteUrl = normalizeMarketSiteUrl(input.siteUrl);
  const whatsappUrl = getOfficialOwnerWhatsAppUrl(
    input.ownerWhatsAppUrl ?? undefined,
  );
  const exchange = `${siteUrl}/en/usdt-exchange`;
  const settings = `${siteUrl}/en/settings`;
  const dashboard = `${siteUrl}/en/dashboard/seller`;
  const safety = `${siteUrl}/en/safety-trust`;
  const support = `${siteUrl}/en/support`;
  const contact = `${siteUrl}/en/contact`;
  const academy = `${siteUrl}/en/academy`;
  const rankDescription =
    "Rank is based only on lifetime completed USDT volume. Successful trades build history; completed volume advances rank; consistent activity strengthens reputation signals buyers can inspect. Rank does not guarantee sales, income, fee discounts, extra listings, or priority placement.";

  const messages: Record<
    DiscordOnboardingContentKey,
    RESTPostAPIChannelMessageJSONBody
  > = {
    welcome: {
      allowed_mentions: { parse: [] },
      embeds: [baseEmbed(
        "Welcome to Alpha Traders",
        "Alpha Traders is the Discord companion to Alpha Exchange. Learn here, link your account securely, then complete listings, payments, evidence, and trades only on the official website.",
      )],
      components: [actionRow(
        linkButton("Open Alpha Exchange", exchange),
        linkButton("Link Account", settings),
        linkButton("Help Center", `${siteUrl}/en/help-center`),
      )],
    },
    how_alpha_exchange_works: {
      allowed_mentions: { parse: [] },
      embeds: [{
        ...baseEmbed(
          "How Alpha Exchange works",
          "The website is the single source of truth. Buyers choose an approved listing, submit a request, and follow the protected trade room. Sellers accept, verify funds, release USDT, and complete the trade through the website workflow.",
        ),
        fields: [{
          name: "Trade sequence",
          value: "Pending → Accepted → Payment sent → Funds received → USDT release pending → USDT sent → Completed / review.",
        }, {
          name: "Discord's role",
          value: "Education, privacy-safe market information, account-linked status, and official links. Discord never creates or modifies a trade.",
        }],
      }],
      components: [actionRow(linkButton("Open Exchange", exchange), linkButton("Safety Center", safety))],
    },
    buyer_guide: {
      allowed_mentions: { parse: [] },
      embeds: [{
        ...baseEmbed(
          "Buyer guide",
          "Verify your account, browse approved active listings, compare seller reputation signals, submit your request, and complete every step in the Alpha Exchange trade room.",
        ),
        fields: [{
          name: "Compare safely",
          value: "Review price, trust, completed trades, response time, rating, and public volume where the seller permits those statistics.",
        }, {
          name: "Keep private data private",
          value: "Never send funds, wallet details, identity documents, evidence, passwords, or recovery codes through Discord.",
        }],
      }],
      components: [actionRow(linkButton("Buy USDT", exchange), linkButton("Buyer Support", support))],
    },
    become_a_seller: {
      allowed_mentions: { parse: [] },
      embeds: [{
        ...baseEmbed(
          "Become an Approved Seller",
          "Start with a verified buyer account. The website application requires your full name, official contact number, and at least one selling network or method. Approval remains an owner/admin-reviewed website decision.",
        ),
        fields: [{
          name: "After approval",
          value: "Your website status drives Discord role sync. Create and manage listings from the seller dashboard; Discord never approves sellers or publishes listings.",
        }],
      }],
      components: [actionRow(linkButton("Apply / Account Settings", settings), linkButton("Seller Dashboard", dashboard))],
    },
    seller_ranks_public: {
      allowed_mentions: { parse: [] },
      embeds: [{ ...baseEmbed("Seller ranks", rankDescription), fields: rankFields() }],
      components: [actionRow(linkButton("View Approved Sellers", exchange))],
    },
    seller_rules_public: {
      allowed_mentions: { parse: [] },
      embeds: [{ ...baseEmbed("Seller rules", "Current Alpha Exchange operating rules."), fields: rulesFields() }],
      components: [actionRow(linkButton("Safety Center", safety), linkButton("Terms", `${siteUrl}/en/terms`))],
    },
    support: {
      allowed_mentions: { parse: [] },
      embeds: [baseEmbed(
        "Support",
        "Use the shared buyer-support or seller-support channel for general guidance only. Submit account or trade details through official website support—not Discord.",
      )],
      components: [actionRow(linkButton("Support", support), linkButton("Help Center", `${siteUrl}/en/help-center`), linkButton("Contact", contact))],
    },
    contact_owner: {
      allowed_mentions: { parse: [] },
      embeds: [baseEmbed(
        "Contact the owner",
        whatsappUrl
          ? "Use only the configured official Alpha Traders contact buttons below."
          : "Use the official website Contact or Support page. No WhatsApp destination is published unless it is explicitly configured.",
      )],
      components: [actionRow(
        linkButton("Contact", contact),
        linkButton("Support", support),
        ...(whatsappUrl ? [linkButton("Official WhatsApp", whatsappUrl)] : []),
      )],
    },
    seller_dashboard_help: {
      allowed_mentions: { parse: [] },
      embeds: [baseEmbed(
        "Seller dashboard help",
        "Manage listings, requests, Vacation Mode, commission status, and profile settings on Alpha Exchange. Discord is guidance only and never mutates seller state.",
      )],
      components: [actionRow(linkButton("Seller Dashboard", dashboard), linkButton("Marketplace", exchange), linkButton("Academy", academy))],
    },
    seller_ranks: {
      allowed_mentions: { parse: [] },
      embeds: [{
        ...baseEmbed("Your seller progression", `${rankDescription}\n\nUse /rank for your private, account-linked progress.`),
        fields: rankFields(),
      }],
      components: [actionRow(linkButton("Seller Dashboard", dashboard))],
    },
    seller_rules: {
      allowed_mentions: { parse: [] },
      embeds: [{ ...baseEmbed("Approved Seller operating rules", "These rules are generated from the same contracts used by Alpha Exchange."), fields: rulesFields() }],
      components: [actionRow(linkButton("Seller Dashboard", dashboard), linkButton("Safety Center", safety), linkButton("Seller Support", support))],
    },
  };
  return messages[input.key];
}

export function hashDiscordOnboardingContent(
  message: RESTPostAPIChannelMessageJSONBody,
): string {
  return createHash("sha256").update(JSON.stringify(message)).digest("hex");
}
