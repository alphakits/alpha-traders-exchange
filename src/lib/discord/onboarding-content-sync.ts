import "server-only";

import { createHash } from "node:crypto";

import {
  REST,
  Routes,
  type RESTGetAPIChannelMessageResult,
  type RESTGetAPIChannelMessagesResult,
} from "discord.js";
import type { Pool } from "pg";
import { logEvent } from "@/lib/structured-logging";
import type { DiscordOnboardingContentDiagnostics } from "@/lib/discord/diagnostics";

import {
  DISCORD_ONBOARDING_CONTENT_KEYS,
  DISCORD_ONBOARDING_CONTENT_MARKER,
  DISCORD_ONBOARDING_RESOURCE_BY_CONTENT,
  buildDiscordOnboardingContent,
  hashDiscordOnboardingContent,
  type DiscordOnboardingContentKey,
} from "@/lib/discord/onboarding-content";

function nonceFor(key: DiscordOnboardingContentKey): string {
  return createHash("sha256")
    .update(`alpha-onboarding:${key}`)
    .digest("hex")
    .slice(0, 25);
}

function ownsMessage(
  message: RESTGetAPIChannelMessageResult,
  nonce: string,
  botUserId?: string,
): boolean {
  const hasMarker = message.embeds.some((embed) =>
    embed.footer?.text === DISCORD_ONBOARDING_CONTENT_MARKER);
  if (!hasMarker) return false;
  if (String(message.nonce ?? "") === nonce) return true;
  return Boolean(botUserId && message.author?.id === botUserId);
}

function containsDesiredContent(actual: unknown, desired: unknown): boolean {
  if (Array.isArray(desired)) {
    return Array.isArray(actual)
      && actual.length === desired.length
      && desired.every((value, index) =>
        containsDesiredContent(actual[index], value));
  }
  if (desired && typeof desired === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
      return false;
    }
    const actualRecord = actual as Record<string, unknown>;
    return Object.entries(desired).every(([key, value]) =>
      containsDesiredContent(actualRecord[key], value));
  }
  return Object.is(actual, desired);
}

function apiCode(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = Number((error as { code: unknown }).code);
  return Number.isFinite(code) ? code : null;
}

export class DiscordOnboardingContentSync {
  private readonly pool: Pool;
  private readonly rest: REST;
  private readonly siteUrl: string;
  private readonly ownerWhatsAppUrl: string | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private diagnostics: DiscordOnboardingContentDiagnostics = {
    status: "degraded",
    totalCount: DISCORD_ONBOARDING_CONTENT_KEYS.length,
    activeCount: 0,
    errorCode: "not_reconciled",
  };

  constructor(input: {
    pool: Pool;
    token: string;
    siteUrl: string;
    ownerWhatsAppUrl?: string | null;
    rest?: REST;
  }) {
    this.pool = input.pool;
    this.rest = input.rest ?? new REST({ version: "10" }).setToken(input.token);
    this.siteUrl = input.siteUrl;
    this.ownerWhatsAppUrl = input.ownerWhatsAppUrl ?? null;
  }

  async start(): Promise<void> {
    try {
      await this.reconcile();
    } catch (error) {
      logEvent("error", {
        event: "discord_onboarding_content_sync",
        outcome: "failed",
        reason: error instanceof Error
          && /^[a-z0-9_]{1,64}$/.test(error.message)
          ? error.message
          : "onboarding_content_sync_failed",
      });
    }
    this.timer ??= setInterval(() => {
      void this.reconcile().catch((error: unknown) => {
        logEvent("error", {
          event: "discord_onboarding_content_sync",
          outcome: "failed",
          reason: error instanceof Error
            && /^[a-z0-9_]{1,64}$/.test(error.message)
            ? error.message
            : "onboarding_content_sync_failed",
        });
      });
    }, 15 * 60 * 1000);
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getDiagnostics(): DiscordOnboardingContentDiagnostics {
    return { ...this.diagnostics };
  }

  async reconcile(): Promise<void> {
    let activeCount = 0;
    try {
      const bot = await this.rest.get(Routes.user("@me")) as { id?: string };
      const botUserId = typeof bot.id === "string" ? bot.id : undefined;
      for (const key of DISCORD_ONBOARDING_CONTENT_KEYS) {
        await this.reconcileOne(key, botUserId);
        activeCount += 1;
      }
      this.diagnostics = {
        status: "ready",
        totalCount: DISCORD_ONBOARDING_CONTENT_KEYS.length,
        activeCount,
        errorCode: null,
      };
    } catch (error) {
      this.diagnostics = {
        status: "degraded",
        totalCount: DISCORD_ONBOARDING_CONTENT_KEYS.length,
        activeCount,
        errorCode: error instanceof Error
          && /^[a-z0-9_]{1,64}$/.test(error.message)
          ? error.message
          : "onboarding_content_sync_failed",
      };
      throw error;
    }
  }

  private async reconcileOne(key: DiscordOnboardingContentKey, botUserId?: string): Promise<void> {
    const resourceKey = DISCORD_ONBOARDING_RESOURCE_BY_CONTENT[key];
    const result = await this.pool.query<{
      channel_id: string;
      message_id: string | null;
      content_hash: string | null;
    }>(
      `select resource.discord_resource_id as channel_id,
              content.message_id,
              content.content_hash
         from alpha_exchange.discord_onboarding_content content
         join alpha_exchange.discord_managed_resources resource
           on resource.resource_key = content.channel_resource_key
        where content.content_key = $1
          and content.channel_resource_key = $2
          and resource.reconciliation_state = 'ready'
          and resource.discord_resource_id is not null`,
      [key, resourceKey],
    );
    const row = result.rows[0];
    if (!row) throw new Error("onboarding_resource_not_ready");
    const message = buildDiscordOnboardingContent({
      key,
      siteUrl: this.siteUrl,
      ownerWhatsAppUrl: this.ownerWhatsAppUrl,
    });
    const contentHash = hashDiscordOnboardingContent(message);
    const nonce = nonceFor(key);
    let messageId = row.message_id;
    let owned: RESTGetAPIChannelMessageResult | null = null;

    if (messageId) {
      try {
        const current = await this.rest.get(
          Routes.channelMessage(row.channel_id, messageId),
        ) as RESTGetAPIChannelMessageResult;
        if (!ownsMessage(current, nonce, botUserId)) {
          // A persisted message ID can outlive the worker-owned message it
          // referred to. Never mutate the foreign message; recover through
          // nonce-based discovery or create a new owned message below.
          messageId = null;
          owned = null;
        } else {
          owned = current;
        }
      } catch (error) {
        if (apiCode(error) !== 10008) throw error;
        messageId = null;
      }
    }

    if (!messageId) {
      const recent = await this.rest.get(
        Routes.channelMessages(row.channel_id),
        { query: new URLSearchParams({ limit: "100" }) },
      ) as RESTGetAPIChannelMessagesResult;
      owned = recent.find((candidate) => ownsMessage(candidate, nonce, botUserId)) ?? null;
      messageId = owned?.id ?? null;
    }

    if (!messageId) {
      const created = await this.rest.post(
        Routes.channelMessages(row.channel_id),
        {
          body: { ...message, nonce, enforce_nonce: true },
        },
      ) as RESTGetAPIChannelMessageResult;
      messageId = created.id;
    } else if (
      row.content_hash !== contentHash
      || !owned
      || !containsDesiredContent(owned, message)
    ) {
      await this.rest.patch(
        Routes.channelMessage(row.channel_id, messageId),
        { body: message },
      );
    }

    const persisted = await this.pool.query(
      `update alpha_exchange.discord_onboarding_content
          set channel_id = $2,
              message_id = $3,
              content_hash = $4,
              state = 'active',
              last_error_code = null,
              last_synced_at = now(),
              updated_at = now()
        where content_key = $1
          and channel_resource_key = $5`,
      [key, row.channel_id, messageId, contentHash, resourceKey],
    );
    if (persisted.rowCount !== 1) {
      throw new Error("onboarding_content_persistence_failed");
    }
  }
}
