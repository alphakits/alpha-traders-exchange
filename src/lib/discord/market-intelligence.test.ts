// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("discord.js", () => ({
  DiscordAPIError: class DiscordAPIError extends Error {
    code = 0;
  },
  REST: class REST {
    setToken() {
      return this;
    }
  },
  Routes: {},
}));

import type { DiscordMarketIntelligenceDiagnostics } from "@/lib/discord/diagnostics";
import {
  buildDiscordMarketContentMessage,
  escapeDiscordPlainText,
  type DiscordMarketContentPublisher,
  type DiscordMarketContentSnapshot,
} from "@/lib/discord/market-intelligence-publisher";
import {
  getPublicDiscordSellerProfileByUsername,
  PostgresDiscordMarketContentRepository,
  rankWeeklySellers,
  type DiscordMarketContentClaim,
  type DiscordMarketContentRepository,
} from "@/lib/discord/market-intelligence-repository";
import { DiscordMarketIntelligenceWorker } from "@/lib/discord/market-intelligence-worker";
import { buildDiscordSellerProfileCard } from "@/lib/discord/seller-profile-card";

const pulse: DiscordMarketContentSnapshot = {
  kind: "live_market_pulse",
  generatedAt: "2026-08-08T05:00:00.000Z",
  approvedPublicSellers: 4,
  activeEligibleListings: 6,
  totalAvailableUsdt: 1200,
  averageResponseMinutes: null,
  activeTrades: 2,
  sellersOnline: 1,
  buyersOnline: 3,
  siteUrl: "https://www.alphatraders.co.il",
};

const readyDiagnostics: DiscordMarketIntelligenceDiagnostics = {
  status: "ready",
  activeCount: 3,
  pendingCount: 0,
  deadCount: 0,
  lastSuccessAt: "2026-08-08T05:00:00.000Z",
  errorCode: null,
};

function claim(version = 1): DiscordMarketContentClaim {
  return {
    contentKey: "live_market_pulse",
    channelId: "1".repeat(18),
    messageId: null,
    contentVersion: version,
    leaseFence: version,
    leaseToken: "123e4567-e89b-42d3-a456-426614174000",
    attempts: 1,
  };
}

class SharedRepository implements DiscordMarketContentRepository {
  claimed = false;
  completed = 0;
  failed: string[] = [];

  async claimDueContent() {
    if (this.claimed) return null;
    this.claimed = true;
    return claim();
  }

  async buildSnapshot() {
    return pulse;
  }

  async ownsClaim() {
    return true;
  }

  async completeContent() {
    this.completed += 1;
    return true;
  }

  async failContent(input: { errorCode: string }) {
    this.failed.push(input.errorCode);
  }

  async getDiagnostics() {
    return readyDiagnostics;
  }
}

class SharedPublisher implements DiscordMarketContentPublisher {
  created = 0;
  updated = 0;

  async createMessage() {
    this.created += 1;
    return "2".repeat(18);
  }

  async findOwnedMessage() {
    return null;
  }

  async ownsMessage() {
    return false;
  }

  async updateMessage() {
    this.updated += 1;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Discord market intelligence content", () => {
  it("renders only authoritative pulse metrics and omits unavailable response data", () => {
    const message = buildDiscordMarketContentMessage(pulse);
    const serialized = JSON.stringify(message);

    expect(serialized).toContain("Approved public sellers");
    expect(serialized).toContain("Available liquidity");
    expect(serialized).not.toContain("Measured listing response");
    expect(serialized).not.toMatch(/buyerId|tradeId|wallet|email|internal/i);
  });

  it("renders an anonymized singleton activity digest without financial details", () => {
    const message = buildDiscordMarketContentMessage({
      kind: "market_activity_digest",
      generatedAt: "2026-08-08T05:00:00.000Z",
      windowStartedAt: "2026-08-07T05:00:00.000Z",
      approvedListingsAdded: 3,
      completedTrades: 2,
      newlyApprovedSellers: 1,
      siteUrl: "https://www.alphatraders.co.il",
    });
    const serialized = JSON.stringify(message);

    expect(serialized).toContain("24H DIGEST");
    expect(serialized).not.toMatch(
      /buyer[_ -]?id|trade[_ -]?id|wallet|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|0x[a-f0-9]{32,}/i,
    );
  });

  it("ranks weekly sellers deterministically and renders a truthful no-data state", () => {
    const ranked = rankWeeklySellers([
      { sellerId: "b", displayName: "Bravo", completedTrades: 2, trustScore: 90, rating: 4.9 },
      { sellerId: "a", displayName: "Alpha", completedTrades: 2, trustScore: 90, rating: 4.9 },
      { sellerId: "c", displayName: "Charlie", completedTrades: 3, trustScore: 70, rating: 4.5 },
    ]);
    expect(ranked.map((entry) => entry.displayName)).toEqual([
      "Charlie",
      "Alpha",
      "Bravo",
    ]);

    const noData = buildDiscordMarketContentMessage({
      kind: "weekly_top_sellers",
      generatedAt: "2026-08-08T05:00:00.000Z",
      windowStartedAt: "2026-08-03T00:00:00.000Z",
      windowEndsAt: "2026-08-10T00:00:00.000Z",
      timeZoneLabel: "UTC",
      entries: [],
      siteUrl: "https://www.alphatraders.co.il",
    });
    expect(JSON.stringify(noData)).toContain("No public approved seller");
  });

  it("escapes public display names so leaderboard text cannot inject links or mentions", () => {
    const malicious = "[Alpha Support](https://phishing.example) @everyone";
    const escaped = escapeDiscordPlainText(malicious);
    const message = buildDiscordMarketContentMessage({
      kind: "weekly_top_sellers",
      generatedAt: "2026-08-08T05:00:00.000Z",
      windowStartedAt: "2026-08-03T00:00:00.000Z",
      windowEndsAt: "2026-08-10T00:00:00.000Z",
      timeZoneLabel: "UTC",
      entries: [{
        displayName: malicious,
        completedTrades: 2,
        trustScore: 90,
        rating: 4.9,
      }],
      siteUrl: "https://www.alphatraders.co.il",
    });
    const serialized = JSON.stringify(message);

    expect(escaped).not.toContain("https://");
    expect(serialized).not.toContain("[Alpha Support](");
    expect(serialized).not.toContain("@everyone");
    expect(message.allowed_mentions).toEqual({ parse: [] });
  });

  it("allows two workers to claim and create at most one singleton message", async () => {
    const repository = new SharedRepository();
    const publisher = new SharedPublisher();
    const workers = [
      new DiscordMarketIntelligenceWorker({ repository, publisher }),
      new DiscordMarketIntelligenceWorker({ repository, publisher }),
    ];

    await Promise.all(workers.map((worker) => worker.tick()));

    expect(publisher.created).toBe(1);
    expect(repository.completed).toBe(1);
    expect(repository.failed).toEqual([]);
  });

  it("repairs a missing mapped message and never edits an unrelated message", async () => {
    const repository = new SharedRepository();
    const publisher = new SharedPublisher();
    const ownsMessage = vi.spyOn(publisher, "ownsMessage").mockResolvedValue(false);
    const findOwnedMessage = vi.spyOn(publisher, "findOwnedMessage").mockResolvedValue(null);
    let claimed = false;
    repository.claimDueContent = vi.fn(async () => {
      if (claimed) return null;
      claimed = true;
      return {
        ...claim(),
        messageId: "9".repeat(18),
      };
    });
    const worker = new DiscordMarketIntelligenceWorker({ repository, publisher });

    await worker.tick();

    expect(ownsMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: "9".repeat(18),
    }));
    expect(findOwnedMessage).toHaveBeenCalledOnce();
    expect(publisher.updated).toBe(0);
    expect(publisher.created).toBe(1);
  });

  it("uses one non-blocking cadence timer without duplicate timers or listeners", async () => {
    vi.useFakeTimers();
    const repository = new SharedRepository();
    repository.claimed = true;
    const worker = new DiscordMarketIntelligenceWorker({
      repository,
      publisher: new SharedPublisher(),
      pollIntervalMs: 1_000,
    });

    await worker.start();
    await worker.start();
    expect(vi.getTimerCount()).toBe(1);
    await worker.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("defines pulse metrics with database clock, public eligibility, and real presence windows", async () => {
    let capturedSql = "";
    const pool = {
      query: vi.fn(async (sql: string) => {
        capturedSql = sql;
        return {
          rows: [{
            server_time: new Date("2026-08-08T05:00:00.000Z"),
            approved_public_sellers: 2,
            active_eligible_listings: 3,
            total_available_usdt: "950.5",
            average_response_minutes: null,
            active_trades: 1,
            sellers_online: 1,
            buyers_online: 4,
          }],
        };
      }),
    };
    const repository = new PostgresDiscordMarketContentRepository({
      pool: pool as never,
      siteUrl: "https://www.alphatraders.co.il",
    });

    await expect(repository.buildSnapshot("live_market_pulse")).resolves.toMatchObject({
      generatedAt: "2026-08-08T05:00:00.000Z",
      approvedPublicSellers: 2,
      activeEligibleListings: 3,
      totalAvailableUsdt: 950.5,
      averageResponseMinutes: null,
    });
    expect(capturedSql).toContain("seller_status = 'approved_seller'");
    expect(capturedSql).toContain("isProfileHidden");
    expect(capturedSql).toContain("approvalStatus");
    expect(capturedSql).toContain("payment_status <> 'paid'");
    expect(capturedSql).toContain("lastActiveAt");
    expect(capturedSql).toContain("showLastActive");
    expect(capturedSql).toContain("isProfileHidden");
    expect(capturedSql).toContain("now()");
  });

  it("claims only due fixed content in ready managed channels with a fenced lease", async () => {
    let capturedSql = "";
    const pool = {
      query: vi.fn(async (sql: string) => {
        capturedSql = sql;
        return { rows: [] };
      }),
    };
    const repository = new PostgresDiscordMarketContentRepository({
      pool: pool as never,
      siteUrl: "https://www.alphatraders.co.il",
    });

    await repository.claimDueContent();

    expect(capturedSql).toContain("discord_managed_resources");
    expect(capturedSql).toContain("reconciliation_state = 'ready'");
    expect(capturedSql).toContain("for update of content skip locked");
    expect(capturedSql).toContain("lease_fence = content.lease_fence + 1");
    expect(capturedSql).not.toContain("$1");
  });

  it("rejects stale completion and bounds the eighth failed attempt as dead", async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        return { rows: [], rowCount: 0 };
      }),
    };
    const repository = new PostgresDiscordMarketContentRepository({
      pool: pool as never,
      siteUrl: "https://www.alphatraders.co.il",
    });
    const staleClaim = { ...claim(7), attempts: 8 };

    await expect(repository.completeContent({
      claim: staleClaim,
      messageId: "2".repeat(18),
      snapshot: pulse,
      snapshotHash: "a".repeat(64),
    })).resolves.toBe(false);
    await repository.failContent({
      claim: staleClaim,
      errorCode: "discord_api_failure",
    });

    expect(calls[0]?.sql).toContain("content_version = $2");
    expect(calls[0]?.sql).toContain("lease_fence = $3");
    expect(calls[0]?.sql).toContain("lease_token = $4::uuid");
    expect(calls[1]?.values).toContain("dead");
    expect(calls[1]?.values).toContain("discord_api_failure");
  });

  it("checks lease ownership immediately before any Discord mutation", async () => {
    const repository = new SharedRepository();
    repository.ownsClaim = vi.fn(async () => false);
    const publisher = new SharedPublisher();
    const worker = new DiscordMarketIntelligenceWorker({ repository, publisher });

    await worker.tick();

    expect(repository.ownsClaim).toHaveBeenCalledOnce();
    expect(publisher.created).toBe(0);
    expect(publisher.updated).toBe(0);
    expect(repository.failed).toEqual(["stale_content_lease"]);
  });

  it("drains an in-flight reconciliation during clean shutdown", async () => {
    let releaseClaim!: () => void;
    const claimGate = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    const repository = new SharedRepository();
    repository.claimDueContent = vi.fn(async () => {
      await claimGate;
      return null;
    });
    const worker = new DiscordMarketIntelligenceWorker({
      repository,
      publisher: new SharedPublisher(),
    });
    const tick = worker.tick();
    const shutdown = worker.shutdown();

    let shutdownCompleted = false;
    void shutdown.then(() => {
      shutdownCompleted = true;
    });
    await Promise.resolve();
    expect(shutdownCompleted).toBe(false);

    releaseClaim();
    await Promise.all([tick, shutdown]);
    expect(shutdownCompleted).toBe(true);
  });
});

describe("Discord public seller profile boundary", () => {
  it("returns only linked public approved profile data and builds a PII-free card", async () => {
    let capturedSql = "";
    const pool = {
      query: vi.fn(async (sql: string) => {
        capturedSql = sql;
        return {
          rows: [{
            created_at: new Date("2024-01-01T00:00:00.000Z"),
            payload: {
              fullName: "Private Legal Name",
              email: "private@example.com",
              buyerDisplayName: "Alpha Seller",
              onlineStatus: "online",
              lastActiveAt: "2026-08-08T04:59:00.000Z",
              profilePhotoUrl: "https://cdn.example.com/alpha.png",
            },
            trust_payload: {
              snapshot: {
                level: "gold",
                rating: 4.95,
                reliabilityScore: 92,
                completedTrades: 40,
                publicVolumeRange: "10K+ USDT",
                responseTimeMinutes: 4,
              },
            },
          }],
        };
      }),
    };
    const profile = await getPublicDiscordSellerProfileByUsername({
      username: "alpha-seller",
      pool: pool as never,
      siteUrl: "https://www.alphatraders.co.il",
      now: new Date("2026-08-08T05:00:00.000Z").getTime(),
    });
    const card = buildDiscordSellerProfileCard(profile!);
    const serialized = JSON.stringify({ profile, card });

    expect(capturedSql).toContain("seller_status = 'approved_seller'");
    expect(capturedSql).toContain("discord_identities");
    expect(capturedSql).toContain("isProfileHidden");
    expect(profile).toMatchObject({
      displayName: "Alpha Seller",
      level: "gold",
      completedTrades: 40,
      publicVolumeRange: "10K+ USDT",
    });
    expect(serialized).not.toMatch(/Private Legal Name|private@example|sellerId/i);
  });

  it("escapes unsafe public names in reusable profile cards", () => {
    const card = buildDiscordSellerProfileCard({
      displayName: "[Support](https://phishing.example) @everyone",
      level: null,
      rating: null,
      reliabilityScore: null,
      completedTrades: null,
      publicVolumeRange: null,
      memberSince: "2024-01-01T00:00:00.000Z",
      presenceLabel: null,
      responseTimeMinutes: null,
      profileUrl: "https://www.alphatraders.co.il/en/exchange/seller/support",
      imageUrl: null,
      siteUrl: "https://www.alphatraders.co.il",
    });
    const serialized = JSON.stringify(card);

    expect(serialized).not.toContain("[Support](");
    expect(serialized).not.toContain("@everyone");
  });

  it("omits trade statistics and unsafe images when public settings disable them", async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{
          created_at: new Date("2024-01-01T00:00:00.000Z"),
          payload: {
            buyerDisplayName: "Private Stats",
            showTradeStats: false,
            showLastActive: false,
            profilePhotoUrl: "http://localhost/private.png",
          },
          trust_payload: {
            snapshot: {
              rating: 5,
              reliabilityScore: 99,
              completedTrades: 500,
              publicVolumeRange: "1M+ USDT",
              responseTimeMinutes: 1,
            },
          },
        }],
      })),
    };
    const profile = await getPublicDiscordSellerProfileByUsername({
      username: "private-stats",
      pool: pool as never,
      siteUrl: "https://www.alphatraders.co.il",
    });

    expect(profile).toMatchObject({
      rating: null,
      reliabilityScore: null,
      completedTrades: null,
      publicVolumeRange: null,
      responseTimeMinutes: null,
      presenceLabel: null,
      imageUrl: null,
    });
  });
});
