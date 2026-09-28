import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  fetchDiscordWorkerDiagnostics: vi.fn(),
  readDiscordManagementDatabaseDiagnostics: vi.fn(),
  buildDiscordManagementDiagnostics: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({
  requireApiAdmin: mocks.requireApiAdmin,
}));
vi.mock("@/lib/discord/worker-health-client", () => ({
  fetchDiscordWorkerDiagnostics: mocks.fetchDiscordWorkerDiagnostics,
}));
vi.mock("@/lib/discord/management", () => ({
  readDiscordManagementDatabaseDiagnostics:
    mocks.readDiscordManagementDatabaseDiagnostics,
  buildDiscordManagementDiagnostics: mocks.buildDiscordManagementDiagnostics,
}));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));

import { GET } from "@/app/api/admin/discord/diagnostics/route";

const safeDashboard = {
  generatedAt: "2026-08-08T06:00:00.000Z",
  status: "healthy",
  worker: {
    status: "healthy",
    connected: true,
    ready: true,
    readyState: "ready",
    apiLatencyMs: 38,
    connectionUptimeMs: 900,
    deployment: { revision: "de96c1b", environment: "production" },
    error: null,
  },
  resources: {
    status: "ready",
    total: 13,
    ready: 13,
    missing: 0,
    errorCode: null,
  },
  database: {
    identities: { connected: 4 },
    approvedSellerRoleSync: { synced: 3, pending: 1, failed: 0 },
    listings: {
      lifecycle: {
        queued: 0,
        publishing: 0,
        active: 2,
        update_pending: 0,
        delete_pending: 0,
        sold: 1,
        deleted: 1,
        failed: 0,
      },
      activePosts: 2,
      cooldownClaims: 1,
      jobs: {
        pending: 0,
        processing: 0,
        completed: 5,
        dead: 0,
        staleLeases: 0,
        failures: 0,
      },
    },
    marketContent: [],
    notifications: {
      pending: 0,
      processing: 0,
      completed: 3,
      dead: 0,
      suppressed: 1,
    },
    interactions: {
      accepted24h: 4,
      rateLimited24h: 1,
      replayed24h: 0,
    },
    operatorRequests: {
      pending: 0,
      processing: 0,
      dead: 0,
      staleLeases: 0,
      latest: null,
    },
    recentErrors: [],
  },
  commands: {
    names: ["market", "profile", "listing", "share", "website", "help", "pulse"],
    registered: 7,
    expected: 7,
    lastReconciledAt: "2026-08-08T05:00:00.000Z",
    status: "ready",
    errorCode: null,
  },
  topology: [{ key: "marketplace_listings", type: "text", name: "marketplace-listings" }],
  privilegedIntents: ["GuildMembers"],
};

function request() {
  return new NextRequest("http://localhost/api/admin/discord/diagnostics");
}

describe("Discord management diagnostics route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAdmin.mockResolvedValue({
      user: { id: crypto.randomUUID(), role: "admin" },
      unauthorized: null,
    });
    mocks.fetchDiscordWorkerDiagnostics.mockResolvedValue({ status: "healthy" });
    mocks.readDiscordManagementDatabaseDiagnostics.mockResolvedValue({ identities: {} });
    mocks.buildDiscordManagementDiagnostics.mockReturnValue(safeDashboard);
  });

  it("denies unauthenticated and non-admin actors before reading diagnostics", async () => {
    for (const status of [401, 403]) {
      mocks.requireApiAdmin.mockResolvedValueOnce({
        user: null,
        unauthorized: NextResponse.json({ error: "Denied" }, { status }),
      });
      const response = await GET(request());
      expect(response.status).toBe(status);
    }
    expect(mocks.fetchDiscordWorkerDiagnostics).not.toHaveBeenCalled();
    expect(mocks.readDiscordManagementDatabaseDiagnostics).not.toHaveBeenCalled();
  });

  it("allows authoritative admin and owner roles and returns only safe aggregates", async () => {
    for (const role of ["admin", "owner"]) {
      mocks.requireApiAdmin.mockResolvedValueOnce({
        user: { id: crypto.randomUUID(), role },
        unauthorized: null,
      });
      const response = await GET(request());
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload).toEqual(safeDashboard);
      expect(JSON.stringify(payload)).not.toMatch(
        /guildId|discordUserId|platformUserId|email|token|secret|rawPayload|messageId|channelId/i,
      );
    }
  });

  it("returns explicit degraded status instead of a success-shaped fallback", async () => {
    mocks.buildDiscordManagementDiagnostics.mockReturnValue({
      ...safeDashboard,
      status: "offline",
    });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "offline" });
  });

  it("fails closed when safe database aggregates cannot be read", async () => {
    mocks.readDiscordManagementDatabaseDiagnostics.mockRejectedValue(
      new Error("database unavailable"),
    );
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Discord management diagnostics are unavailable.",
      code: "database_diagnostics_failed",
    });
  });
});
