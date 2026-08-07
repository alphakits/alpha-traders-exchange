import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  fetchDiscordWorkerDiagnostics: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({
  requireApiAdmin: mocks.requireApiAdmin,
}));
vi.mock("@/lib/discord/worker-health-client", () => ({
  fetchDiscordWorkerDiagnostics: mocks.fetchDiscordWorkerDiagnostics,
}));

import { GET } from "@/app/api/admin/discord/diagnostics/route";

const healthyDiagnostics = {
  status: "healthy",
  connected: true,
  readyState: "ready",
  botUsername: "test-bot",
  guildName: "Test Guild",
  guildId: "5".repeat(18),
  apiLatencyMs: 38,
  connectionUptimeMs: 900,
  error: null,
};

describe("Discord diagnostics route", () => {
  beforeEach(() => {
    mocks.requireApiAdmin.mockReset();
    mocks.fetchDiscordWorkerDiagnostics.mockReset();
  });

  it("returns the existing auth response without initializing Discord", async () => {
    mocks.requireApiAdmin.mockResolvedValue({
      user: null,
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.fetchDiscordWorkerDiagnostics).not.toHaveBeenCalled();
  });

  it("returns safe diagnostics to an authorized admin or owner", async () => {
    mocks.requireApiAdmin.mockResolvedValue({
      user: { id: "authorized-user", role: "admin" },
      unauthorized: null,
    });
    mocks.fetchDiscordWorkerDiagnostics.mockResolvedValue(healthyDiagnostics);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(healthyDiagnostics);
  });

  it("returns 503 with safe degraded diagnostics when the worker is unavailable", async () => {
    const degraded = {
      ...healthyDiagnostics,
      status: "degraded",
      connected: false,
      readyState: "error",
      botUsername: null,
      guildName: null,
      guildId: null,
      apiLatencyMs: null,
      connectionUptimeMs: null,
      error: {
        code: "worker_unavailable",
        message: "Discord worker diagnostics are unavailable.",
      },
    };
    mocks.requireApiAdmin.mockResolvedValue({
      user: { id: "authorized-owner", role: "owner", roles: ["owner", "admin"] },
      unauthorized: null,
    });
    mocks.fetchDiscordWorkerDiagnostics.mockResolvedValue(degraded);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(degraded);
  });

  it("returns proxied reconnecting state without initializing a local gateway", async () => {
    const reconnecting = {
      ...healthyDiagnostics,
      status: "degraded",
      connected: false,
      readyState: "reconnecting",
      apiLatencyMs: null,
      connectionUptimeMs: null,
    };
    mocks.requireApiAdmin.mockResolvedValue({
      user: { id: "authorized-user", role: "admin" },
      unauthorized: null,
    });
    mocks.fetchDiscordWorkerDiagnostics.mockResolvedValue(reconnecting);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(reconnecting);
    expect(mocks.fetchDiscordWorkerDiagnostics).toHaveBeenCalledOnce();
  });
});
