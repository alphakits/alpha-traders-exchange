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
});
