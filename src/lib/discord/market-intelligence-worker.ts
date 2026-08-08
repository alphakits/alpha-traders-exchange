import "server-only";

import { readDiscordConfig } from "@/lib/discord/config";
import type { DiscordMarketIntelligenceDiagnostics } from "@/lib/discord/diagnostics";
import {
  hashDiscordMarketContentSnapshot,
  DiscordMarketMutationError,
  DiscordRestMarketContentPublisher,
  type DiscordMarketContentPublisher,
} from "@/lib/discord/market-intelligence-publisher";
import {
  PostgresDiscordMarketContentRepository,
  type DiscordMarketContentClaim,
  type DiscordMarketContentRepository,
} from "@/lib/discord/market-intelligence-repository";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { getSiteUrl } from "@/lib/site-url";
import { logEvent } from "@/lib/structured-logging";

const POLL_INTERVAL_MS = 30_000;
const MAX_CONTENT_PER_TICK = 3;
const MUTATION_TIMEOUT_MS = 30_000;
const LEASE_COMPLETION_BUFFER_MS = 5_000;

type MarketIntelligenceWorkerDependencies = {
  repository: DiscordMarketContentRepository;
  publisher: DiscordMarketContentPublisher;
  pollIntervalMs?: number;
  mutationTimeoutMs?: number;
};

class DiscordMarketIntelligenceError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "DiscordMarketIntelligenceError";
    this.code = code;
  }
}

function safeErrorCode(error: unknown): string {
  return error instanceof DiscordMarketMutationError
    ? error.code
    : error instanceof DiscordMarketIntelligenceError
    ? error.code
    : "market_content_delivery_failed";
}

function nonceFor(claim: DiscordMarketContentClaim): string {
  return `alpha-market-${claim.contentKey}`;
}

export class DiscordMarketIntelligenceWorker {
  private readonly repository: DiscordMarketContentRepository;
  private readonly publisher: DiscordMarketContentPublisher;
  private readonly pollIntervalMs: number;
  private readonly mutationTimeoutMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private activeTick: Promise<void> | null = null;
  private diagnostics: DiscordMarketIntelligenceDiagnostics = {
    status: "degraded",
    activeCount: null,
    pendingCount: null,
    deadCount: null,
    lastSuccessAt: null,
    errorCode: "not_reconciled",
  };

  constructor({
    repository,
    publisher,
    pollIntervalMs = POLL_INTERVAL_MS,
    mutationTimeoutMs = MUTATION_TIMEOUT_MS,
  }: MarketIntelligenceWorkerDependencies) {
    this.repository = repository;
    this.publisher = publisher;
    this.pollIntervalMs = pollIntervalMs;
    this.mutationTimeoutMs = mutationTimeoutMs;
  }

  getDiagnostics(): DiscordMarketIntelligenceDiagnostics {
    return { ...this.diagnostics };
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        logEvent("error", {
          event: "discord_market_intelligence_tick",
          outcome: "failed",
          reason: safeErrorCode(error),
        });
      });
    }, this.pollIntervalMs);
    queueMicrotask(() => {
      void this.tick().catch((error: unknown) => {
        logEvent("error", {
          event: "discord_market_intelligence_start",
          outcome: "failed",
          reason: safeErrorCode(error),
        });
      });
    });
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.activeTick;
  }

  tick(): Promise<void> {
    if (this.activeTick) return this.activeTick;
    this.activeTick = this.performTick().finally(() => {
      this.activeTick = null;
    });
    return this.activeTick;
  }

  private async performTick(): Promise<void> {
    for (let processed = 0; processed < MAX_CONTENT_PER_TICK; processed += 1) {
      const claim = await this.repository.claimDueContent();
      if (!claim) break;
      try {
        await this.reconcileClaim(claim);
      } catch (error) {
        const errorCode = safeErrorCode(error);
        if (errorCode === "market_mutation_outcome_unknown") {
          await this.repository.quarantineUnknownMutation(claim);
        } else {
          await this.repository.failContent({ claim, errorCode });
        }
        logEvent("error", {
          event: "discord_market_intelligence_reconcile",
          outcome: "failed",
          reason: errorCode,
          metadata: {
            contentKey: claim.contentKey,
            attempt: claim.attempts,
          },
        });
      }
    }
    this.diagnostics = await this.repository.getDiagnostics();
  }

  private async reconcileClaim(
    claim: DiscordMarketContentClaim,
  ): Promise<void> {
    const nonce = nonceFor(claim);
    const snapshot = await this.repository.buildSnapshot(claim.contentKey);
    let messageId = claim.messageId;
    if (
      messageId
      && !await this.publisher.ownsMessage({
        channelId: claim.channelId,
        messageId,
        nonce,
      })
    ) {
      messageId = null;
    }
    if (!messageId) {
      messageId = await this.publisher.findOwnedMessage({
        channelId: claim.channelId,
        nonce,
      });
    }
    const leasedUntil = await this.repository.renewClaimForMutation(claim);
    if (!leasedUntil) {
      throw new DiscordMarketIntelligenceError("stale_content_lease");
    }
    const requestTimeoutMs = Math.min(
      this.mutationTimeoutMs,
      leasedUntil.getTime() - Date.now() - LEASE_COMPLETION_BUFFER_MS,
    );
    if (requestTimeoutMs <= 0) {
      throw new DiscordMarketIntelligenceError("stale_content_lease");
    }
    if (!messageId) {
      messageId = await this.publisher.createMessage({
        channelId: claim.channelId,
        nonce,
        snapshot,
        requestTimeoutMs,
      });
    } else {
      await this.publisher.updateMessage({
        channelId: claim.channelId,
        messageId,
        snapshot,
        requestTimeoutMs,
      });
    }
    const completed = await this.repository.completeContent({
      claim,
      messageId,
      snapshot,
      snapshotHash: hashDiscordMarketContentSnapshot(snapshot),
    });
    if (!completed) {
      throw new DiscordMarketIntelligenceError("stale_content_lease");
    }
  }
}

export function createDiscordMarketIntelligenceWorker():
DiscordMarketIntelligenceWorker {
  const pool = getRuntimePostgresPool();
  if (!pool) {
    throw new Error(
      "Discord market intelligence requires DATABASE_URL or SUPABASE_DB_URL.",
    );
  }
  const config = readDiscordConfig();
  return new DiscordMarketIntelligenceWorker({
    repository: new PostgresDiscordMarketContentRepository({
      pool,
      siteUrl: getSiteUrl(),
    }),
    publisher: new DiscordRestMarketContentPublisher(config.token),
  });
}
