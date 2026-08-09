// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { Pool, QueryResult, QueryResultRow } from "pg";

vi.mock("server-only", () => ({}));

import {
  DISCORD_ONBOARDING_CONTENT_KEYS,
  buildDiscordOnboardingContent,
  hashDiscordOnboardingContent,
} from "@/lib/discord/onboarding-content";
import {
  buildLinkedSellerRankMessage,
  buildLinkedSellerStatusMessage,
} from "@/lib/discord/community-commands";

function result<T extends QueryResultRow>(rows: T[]): QueryResult<T> {
  return { command: "", rowCount: rows.length, oid: 0, fields: [], rows };
}

const siteUrl = "https://www.alphatraders.co.il";
const discordUserId = "1".repeat(18);

describe("Discord onboarding content", () => {
  it("generates every singleton deterministically from shared contracts", () => {
    for (const key of DISCORD_ONBOARDING_CONTENT_KEYS) {
      const first = buildDiscordOnboardingContent({ key, siteUrl });
      const second = buildDiscordOnboardingContent({ key, siteUrl });
      expect(hashDiscordOnboardingContent(first))
        .toBe(hashDiscordOnboardingContent(second));
      expect(JSON.stringify(first)).not.toMatch(
        /email|phone number|wallet address|buyer whatsapp|application notes/i,
      );
    }
    const ranks = JSON.stringify(buildDiscordOnboardingContent({
      key: "seller_ranks_public",
      siteUrl,
    }));
    expect(ranks).toContain("15,000 USDT");
    expect(ranks).toContain("500,000 USDT");
    expect(ranks).not.toMatch(/remaining trades/i);
    expect(ranks).toContain(
      "does not guarantee sales, income, fee discounts, extra listings, or priority placement",
    );
  });

  it("omits WhatsApp when configuration is missing or invalid", () => {
    const missing = buildDiscordOnboardingContent({
      key: "contact_owner",
      siteUrl,
    });
    const invalid = buildDiscordOnboardingContent({
      key: "contact_owner",
      siteUrl,
      ownerWhatsAppUrl: "https://example.com/not-whatsapp",
    });
    expect(JSON.stringify(missing)).not.toContain("Official WhatsApp");
    expect(JSON.stringify(invalid)).not.toContain("Official WhatsApp");
  });

  it("uses only the invoking Discord identity for exact private rank data", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      expect(sql).toContain("identity.discord_user_id = $1");
      expect(sql).not.toContain("buyerDisplayName");
      expect(values).toEqual([discordUserId]);
      return result([{
        snapshot: {
          level: "silver",
          completedTrades: 42,
          lifetimeCompletedVolumeUsdt: 18_450,
          nextRank: "gold",
          remainingVolumeToNextRank: 31_550,
          prestigeProgressPercent: 9.86,
          isRankOverridden: false,
        },
      }]);
    });
    const message = await buildLinkedSellerRankMessage({
      pool: { query } as unknown as Pool,
      siteUrl,
      discordUserId,
    });
    const serialized = JSON.stringify(message);
    expect(serialized).toContain("18,450 USDT");
    expect(serialized).toContain("31,550 USDT");
    expect(serialized).not.toMatch(/email|phone|wallet|buyer|application|enforcement/i);
  });

  it("returns only non-sensitive seller status fields", async () => {
    const message = await buildLinkedSellerStatusMessage({
      pool: {
        query: vi.fn(async () => result([{
          seller_status: "approved_seller",
          availability_status: "vacation",
          active_listings: 1,
        }])),
      } as unknown as Pool,
      siteUrl,
      discordUserId,
    });
    const serialized = JSON.stringify(message);
    expect(serialized).toContain("approved seller");
    expect(serialized).toContain("Vacation Mode");
    expect(serialized).not.toMatch(/email|phone|wallet|buyer|application notes|enforcement/i);
  });
});
