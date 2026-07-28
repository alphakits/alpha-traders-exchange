import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

const mockPool = { query: vi.fn(), connect: vi.fn(), on: vi.fn() } as unknown as Pool;

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => mockPool,
}));

import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";

describe("AlphaExchangeRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__alphaExchangeMemorySnapshot = undefined as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  });

  it("falls back to the in-memory snapshot when the database connection times out", async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error("timeout exceeded when trying to connect")),
      connect: vi.fn(),
      on: vi.fn(),
    } as unknown as Pool;

    const repository = new AlphaExchangeRepository(pool);

    await expect(repository.loadSnapshot()).resolves.toMatchObject({ version: 0 });
  });
});
