import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import { DiscordServiceError } from "@/lib/discord/service";

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  start: vi.fn(),
  getDiagnostics: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({
  requireApiAdmin: mocks.requireApiAdmin,
}));
vi.mock("@/lib/discord", () => ({
  getDiscordService: () => ({
    start: mocks.start,
    getDiagnostics: mocks.getDiagnostics,
  }),
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
    mocks.start.mockReset();
    mocks.getDiagnostics.mockReset();
  });

  it("returns the existing auth response without initializing Discord", async () => {
    mocks.requireApiAdmin.mockResolvedValue({
      user: null,
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("returns safe diagnostics to an authorized admin or owner", async () => {
    mocks.requireApiAdmin.mockResolvedValue({
      user: { id: "authorized-user", role: "admin" },
      unauthorized: null,
    });
    mocks.start.mockResolvedValue(healthyDiagnostics);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(healthyDiagnostics);
  });

  it("returns 503 with safe degraded diagnostics after startup failure", async () => {
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
        code: "login_failed",
        message: "Discord gateway login failed.",
      },
    };
    mocks.requireApiAdmin.mockResolvedValue({
      user: { id: "authorized-owner", role: "owner", roles: ["owner", "admin"] },
      unauthorized: null,
    });
    mocks.start.mockRejectedValue(
      new DiscordServiceError("login_failed", "Discord gateway login failed."),
    );
    mocks.getDiagnostics.mockReturnValue(degraded);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(degraded);
  });

  it("returns 503 without retrying login while Discord is reconnecting", async () => {
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
    mocks.start.mockResolvedValue(reconnecting);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(reconnecting);
  });
});
