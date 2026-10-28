// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
import type { MarketSnapshot } from "@/types/market";
import { demandTestDb, demandTestMarket, demandTestTerms } from "@/test-utils/usdt-demand-fixtures";

const state = vi.hoisted(() => ({
  db: null as AlphaExchangeDb | null,
  market: null as MarketSnapshot | null,
  enqueue: vi.fn(),
}));
vi.mock("@/lib/alpha-exchange-repository", () => ({
  getAlphaExchangeRepository: async () => ({ loadSelectedSnapshot: async () => structuredClone(state.db) }),
}));
vi.mock("@/lib/market-service", () => ({ getMarketSnapshot: async () => state.market }));
vi.mock("@/lib/usdt-demand-store", () => ({
  DEMAND_TABLES: [],
  mutateDemands: async (mutate: (db: AlphaExchangeDb) => unknown) => mutate(state.db!),
}));
vi.mock("@/lib/marketplace-email-delivery", () => ({ sendMarketplaceEmail: state.enqueue }));

import { createDemand } from "@/lib/usdt-demand-engine";
import { canDeliverDemandEmail, queueDemandEmails } from "@/lib/usdt-demand-email";

beforeEach(() => {
  vi.stubEnv("ALPHA_USDT_REQUESTS_ENABLED", "1");
  vi.stubEnv("ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED", "1");
  vi.stubEnv("ALPHA_WISE_DRAFT_ENABLED", "1");
  vi.stubEnv("ALPHA_EXCHANGE_DATA_BACKEND", "json");
  vi.stubEnv("ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY", "1");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("SUPABASE_DB_URL", "");
  vi.stubGlobal("__alphaTradersRuntimeDbPool", undefined);
  for (const key of ["VERCEL_ENV", "VERCEL", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_PROJECT_ID"]) vi.stubEnv(key, "");
  state.db = demandTestDb();
  state.market = demandTestMarket();
  state.enqueue.mockReset().mockResolvedValue({ ok: true, queued: true });
  createDemand(state.db, "buyer", {
    terms: { ...demandTestTerms(), price: "1.01", currency: "USD", bankTransferProvider: "wise" },
    operationId: randomUUID(),
  }, state.market);
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("USD Wise request email eligibility", () => {
  it.each(["stale", "unavailable"])("keeps negotiated USD notices eligible during an unrelated %s ILS quote", async (status) => {
    state.market = demandTestMarket(3.2, status === "stale" ? 300_000 : 0);
    if (status === "unavailable") state.market.unavailablePairs.push("usdtIls");
    const notice = state.db!.notifications.find(entry => entry.userId === "seller")!;
    await expect(canDeliverDemandEmail("seller", "seller@example.test", notice.id, "usdt_demand_published")).resolves.toBe(true);
    await expect(queueDemandEmails()).resolves.toBeUndefined();
    expect(state.enqueue).toHaveBeenCalledTimes(2);
    expect(state.enqueue.mock.calls[0][0].message.en).toContain("USD 1.01");
    expect(state.db!.notifications.every(entry => entry.demandEmail?.state === "queued")).toBe(true);
  });

  it("does not send a queued USD notice after the local Wise gate closes", async () => {
    const notice = state.db!.notifications.find(entry => entry.userId === "seller")!;
    vi.stubEnv("ALPHA_WISE_DRAFT_ENABLED", "0");
    await expect(canDeliverDemandEmail("seller", "seller@example.test", notice.id, "usdt_demand_published")).resolves.toBe(false);
    await queueDemandEmails();
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.db!.notifications.every(entry => entry.demandEmail?.state === "suppressed")).toBe(true);
  });

  it("preserves the normal ILS quote dependency for legacy requests", async () => {
    state.db = demandTestDb();
    createDemand(state.db, "buyer", { terms: demandTestTerms(), operationId: randomUUID() }, demandTestMarket());
    state.market = demandTestMarket(3.2, 300_000);
    await expect(queueDemandEmails()).rejects.toThrow("reference temporarily unavailable");
    expect(state.enqueue).not.toHaveBeenCalled();
    expect(state.db.notifications.every(entry => entry.demandEmail?.state === "pending")).toBe(true);
  });
});
