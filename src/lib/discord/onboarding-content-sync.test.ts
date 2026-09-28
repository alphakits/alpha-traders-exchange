// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { REST } from "discord.js";
import type { Pool, QueryResult, QueryResultRow } from "pg";

vi.mock("server-only", () => ({}));

import {
  DISCORD_ONBOARDING_CONTENT_KEYS,
  DISCORD_ONBOARDING_RESOURCE_BY_CONTENT,
} from "@/lib/discord/onboarding-content";
import { DiscordOnboardingContentSync } from "@/lib/discord/onboarding-content-sync";

function result<T extends QueryResultRow>(
  rows: T[],
  rowCount = rows.length,
): QueryResult<T> {
  return { command: "", rowCount, oid: 0, fields: [], rows };
}

describe("Discord onboarding singleton content sync", () => {
  it("creates once, persists IDs and hashes, then reconciles idempotently", async () => {
    const state = new Map(DISCORD_ONBOARDING_CONTENT_KEYS.map((key, index) => [
      key,
      {
        channelId: `100000000000000${String(index).padStart(3, "0")}`,
        messageId: null as string | null,
        contentHash: null as string | null,
      },
    ]));
    const messages = new Map<string, Record<string, unknown>>();
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      const key = String(values?.[0]) as (typeof DISCORD_ONBOARDING_CONTENT_KEYS)[number];
      const row = state.get(key)!;
      if (sql.includes("select resource.discord_resource_id")) {
        expect(values?.[1]).toBe(DISCORD_ONBOARDING_RESOURCE_BY_CONTENT[key]);
        return result([{
          channel_id: row.channelId,
          message_id: row.messageId,
          content_hash: row.contentHash,
        }]);
      }
      if (sql.includes("update alpha_exchange.discord_onboarding_content")) {
        row.messageId = String(values?.[2]);
        row.contentHash = String(values?.[3]);
        return result([], 1);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    let nextMessage = 0;
    const rest = {
      get: vi.fn(async (route: string) => {
        if (route.endsWith("/users/%40me")) return { id: "bot-user" };
        const message = [...messages.entries()].find(([id]) =>
          route.endsWith(`/${id}`))?.[1];
        return message ?? [];
      }),
      post: vi.fn(async (_route: string, options: { body: Record<string, unknown> }) => {
        nextMessage += 1;
        const id = `200000000000000${String(nextMessage).padStart(3, "0")}`;
        const message = { id, ...options.body };
        messages.set(id, message);
        return message;
      }),
      patch: vi.fn(async (
        route: string,
        options: { body: Record<string, unknown> },
      ) => {
        const entry = [...messages.entries()].find(([id]) =>
          route.endsWith(`/${id}`));
        if (!entry) throw new Error("Missing message");
        Object.assign(entry[1], options.body);
        return entry[1];
      }),
    };
    const sync = new DiscordOnboardingContentSync({
      pool: { query } as unknown as Pool,
      token: "token",
      siteUrl: "https://www.alphatraders.co.il",
      rest: rest as unknown as REST,
    });

    await sync.reconcile();
    await sync.reconcile();

    expect(rest.post).toHaveBeenCalledTimes(DISCORD_ONBOARDING_CONTENT_KEYS.length);
    expect(rest.patch).not.toHaveBeenCalled();
    expect(sync.getDiagnostics()).toEqual({
      status: "ready",
      totalCount: DISCORD_ONBOARDING_CONTENT_KEYS.length,
      activeCount: DISCORD_ONBOARDING_CONTENT_KEYS.length,
      errorCode: null,
    });
    expect([...state.values()].every((row) =>
      row.messageId && /^[0-9]{18}$/.test(row.messageId)
      && row.contentHash && /^[0-9a-f]{64}$/.test(row.contentHash))).toBe(true);

    const welcome = state.get("welcome")!;
    const welcomeMessage = messages.get(welcome.messageId!)!;
    const welcomeEmbeds = welcomeMessage.embeds as Array<Record<string, unknown>>;
    welcomeEmbeds[0].title = "Manually edited title";

    await sync.reconcile();
    await sync.reconcile();

    expect(rest.patch).toHaveBeenCalledTimes(1);
  });

  it("recovers a foreign persisted message through owned history without mutating it", async () => {
    const state = new Map(DISCORD_ONBOARDING_CONTENT_KEYS.map((key, index) => [
      key,
      {
        channelId: `100000000000000${String(index).padStart(3, "0")}`,
        messageId: null as string | null,
        contentHash: null as string | null,
      },
    ]));
    const foreign = {
      id: "200000000000000001",
      nonce: "foreign-nonce",
      embeds: [{ footer: { text: "not-alpha-onboarding" } }],
      content: "foreign content",
      author: { id: "foreign-user" },
    };
    const owned = {
      id: "200000000000000002",
      embeds: [{ footer: { text: "Alpha Traders • Managed onboarding" } }],
      content: "owned historical content",
      author: { id: "bot-user" },
    };
    state.get("welcome")!.messageId = foreign.id;
    const messages = new Map<string, Record<string, unknown>>([[foreign.id, foreign], [owned.id, owned]]);
    const patchedRoutes: string[] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      const key = String(values?.[0]) as (typeof DISCORD_ONBOARDING_CONTENT_KEYS)[number];
      const row = state.get(key)!;
      if (sql.includes("select resource.discord_resource_id")) {
        return result([{ channel_id: row.channelId, message_id: row.messageId, content_hash: row.contentHash }]);
      }
      if (sql.includes("update alpha_exchange.discord_onboarding_content")) {
        row.messageId = String(values?.[2]);
        row.contentHash = String(values?.[3]);
        return result([], 1);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    let nextMessage = 10;
    const createdMessages = new Map<string, Record<string, unknown>>();
    const rest = {
      get: vi.fn(async (route: string) => {
        if (route.endsWith("/users/%40me")) return { id: "bot-user" };
        if (route.endsWith(`/${foreign.id}`)) return foreign;
        if (route.endsWith(`/${owned.id}`)) return owned;
        const created = [...createdMessages.entries()].find(([id]) => route.endsWith(`/${id}`))?.[1];
        if (created) return created;
        return route.includes(state.get("welcome")!.channelId) ? [foreign, owned] : [];
      }),
      post: vi.fn(async (_route: string, options: { body: Record<string, unknown> }) => {
        const id = `200000000000000${String(nextMessage++)}`;
        const message = { id, ...options.body };
        createdMessages.set(id, message);
        messages.set(id, message);
        return message;
      }),
      patch: vi.fn(async (route: string, options: { body: Record<string, unknown> }) => {
        patchedRoutes.push(route);
        const entry = [...messages.entries()].find(([id]) => route.endsWith(`/${id}`));
        if (!entry) throw new Error("Missing message");
        Object.assign(entry[1], options.body);
        return entry[1];
      }),
    };
    const sync = new DiscordOnboardingContentSync({
      pool: { query } as unknown as Pool,
      token: "token",
      siteUrl: "https://www.alphatraders.co.il",
      rest: rest as unknown as REST,
    });

    await sync.reconcile();
    await sync.reconcile();

    expect(foreign).toMatchObject({ nonce: "foreign-nonce", content: "foreign content" });
    expect(patchedRoutes.every((route) => !route.endsWith(`/${foreign.id}`))).toBe(true);
    expect(state.get("welcome")?.messageId).toBe(owned.id);
    expect(state.get("welcome")?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rest.post).toHaveBeenCalledTimes(DISCORD_ONBOARDING_CONTENT_KEYS.length - 1);
    expect(sync.getDiagnostics().status).toBe("ready");
  });

  it("recovers a deleted persisted message and preserves API failures as degraded", async () => {
    const state = new Map(DISCORD_ONBOARDING_CONTENT_KEYS.map((key, index) => [
      key,
      {
        channelId: `100000000000000${String(index).padStart(3, "0")}`,
        messageId: key === "welcome" ? "200000000000000099" : null as string | null,
        contentHash: null as string | null,
      },
    ]));
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      const key = String(values?.[0]) as (typeof DISCORD_ONBOARDING_CONTENT_KEYS)[number];
      const row = state.get(key)!;
      if (sql.includes("select resource.discord_resource_id")) return result([{ channel_id: row.channelId, message_id: row.messageId, content_hash: row.contentHash }]);
      if (sql.includes("update alpha_exchange.discord_onboarding_content")) {
        row.messageId = String(values?.[2]);
        row.contentHash = String(values?.[3]);
        return result([], 1);
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    let nextMessage = 1;
    const rest = {
      get: vi.fn(async (route: string) => {
        if (route.endsWith("/200000000000000099")) {
          const error = new Error("Unknown message") as Error & { code: number };
          error.code = 10008;
          throw error;
        }
        return [];
      }),
      post: vi.fn(async (_route: string, options: { body: Record<string, unknown> }) => ({ id: `20000000000000000${nextMessage++}`, ...options.body })),
      patch: vi.fn(),
    };
    const sync = new DiscordOnboardingContentSync({ pool: { query } as unknown as Pool, token: "token", siteUrl: "https://www.alphatraders.co.il", rest: rest as unknown as REST });
    await sync.reconcile();
    expect(state.get("welcome")?.messageId).not.toBe("200000000000000099");
    expect(sync.getDiagnostics().status).toBe("ready");

    rest.get.mockRejectedValueOnce(Object.assign(new Error("temporary Discord outage"), { code: 50001 }));
    await expect(sync.reconcile()).rejects.toThrow();
    expect(sync.getDiagnostics().status).toBe("degraded");
  });
});
