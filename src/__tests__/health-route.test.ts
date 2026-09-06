// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRuntimeDatabaseHealth: vi.fn(),
}));

vi.mock("@/lib/database-health", () => ({
  checkRuntimeDatabaseHealth: mocks.checkRuntimeDatabaseHealth,
}));

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  beforeEach(() => {
    mocks.checkRuntimeDatabaseHealth.mockReset();
  });

  it("returns the stable healthy response contract", async () => {
    mocks.checkRuntimeDatabaseHealth.mockResolvedValue({ status: "ok", durationMs: 18 });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      checks: { database: "ok" },
      responseTimeMs: 18,
    });
  });

  it("returns 503 when the database readiness probe fails", async () => {
    mocks.checkRuntimeDatabaseHealth.mockResolvedValue({
      status: "error",
      durationMs: 4_001,
      reason: "timeout",
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "degraded",
      checks: { database: "error" },
      responseTimeMs: 4_001,
    });
  });
});
