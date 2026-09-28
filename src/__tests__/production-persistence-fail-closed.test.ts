import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";

describe("production Alpha Exchange persistence", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.__alphaExchangeMemorySnapshot = undefined as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
  });

  it("does not construct an in-memory repository in deployed production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");

    expect(() => new AlphaExchangeRepository(null)).toThrow(/Durable Alpha Exchange persistence/);
  });

  it("fails closed when durable snapshot initialization fails in deployed production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    const pool = {
      query: vi.fn().mockRejectedValue(new Error("database unavailable")),
      connect: vi.fn(),
      on: vi.fn(),
    } as unknown as Pool;
    const repository = new AlphaExchangeRepository(pool);

    await expect(repository.loadSnapshot()).rejects.toThrow(/Durable Alpha Exchange persistence/);
    expect(globalThis.__alphaExchangeMemorySnapshot).toBeUndefined();
  });

  it("retries initialization after a transient production database failure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    const query = vi.fn((queryText: string) => {
      if (query.mock.calls.length === 1) {
        return Promise.reject(new Error("temporary pool failure"));
      }
      if (queryText.includes("to_regclass")) return Promise.resolve({ rows: [{ ready: true }] });
      if (queryText.includes("count(*)::text")) return Promise.resolve({ rows: [{ count: "1" }] });
      if (queryText.includes("from alpha_exchange.runtime_meta")) {
        return Promise.resolve({ rows: [{ version: "7" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const pool = {
      query,
      connect: vi.fn(),
      on: vi.fn(),
    } as unknown as Pool;
    const repository = new AlphaExchangeRepository(pool);

    await expect(repository.loadSnapshot()).rejects.toThrow(/Durable Alpha Exchange persistence/);
    await expect(repository.loadSnapshot()).resolves.toMatchObject({
      users: [],
      purchaseRequests: [],
      __runtimeVersion: 7,
    });
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("to_regclass"))).toHaveLength(2);
    expect(globalThis.__alphaExchangeMemorySnapshot).toBeDefined();
  });
});
