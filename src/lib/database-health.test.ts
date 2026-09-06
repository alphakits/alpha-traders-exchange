// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  checkRuntimeDatabaseHealth,
  DATABASE_HEALTH_TIMEOUT_MS,
} from "@/lib/database-health";

describe("checkRuntimeDatabaseHealth", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses one bounded select without repository initialization", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const pool = { query } as unknown as Pool;

    const result = await checkRuntimeDatabaseHealth({ pool });

    expect(result.status).toBe("ok");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({
      text: "select 1",
      query_timeout: DATABASE_HEALTH_TIMEOUT_MS,
    });
  });

  it("fails readiness within the configured timeout", async () => {
    vi.useFakeTimers();
    const pool = {
      query: vi.fn(() => new Promise(() => undefined)),
    } as unknown as Pool;

    const pending = checkRuntimeDatabaseHealth({ pool, timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toMatchObject({
      status: "error",
      reason: "timeout",
    });
  });

  it("reports connection errors without exposing their details", async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error("contains-sensitive-hostname")),
    } as unknown as Pool;

    await expect(checkRuntimeDatabaseHealth({ pool })).resolves.toMatchObject({
      status: "error",
      reason: "unavailable",
    });
  });
});
