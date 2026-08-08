import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiscordManagementDashboard } from "@/components/admin/discord-management-dashboard";
import type { DiscordManagementDiagnostics } from "@/lib/discord/management";

const diagnostics: DiscordManagementDiagnostics = {
  generatedAt: "2026-08-08T06:00:00.000Z",
  status: "healthy",
  worker: {
    status: "healthy",
    connected: true,
    ready: true,
    readyState: "ready",
    apiLatencyMs: 21,
    connectionUptimeMs: 60_000,
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
    identities: { connected: 5 },
    approvedSellerRoleSync: { synced: 3, pending: 1, failed: 0 },
    listings: {
      lifecycle: {
        queued: 0,
        publishing: 0,
        active: 2,
        update_pending: 0,
        delete_pending: 0,
        sold: 1,
        deleted: 0,
        failed: 0,
      },
      activePosts: 2,
      cooldownClaims: 1,
      jobs: {
        pending: 0,
        processing: 0,
        completed: 3,
        dead: 0,
        staleLeases: 0,
        failures: 0,
      },
    },
    marketContent: [{
      key: "live_market_pulse",
      state: "active",
      lastSuccessAt: "2026-08-08T05:00:00.000Z",
      errorCode: null,
    }],
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
  topology: [{
    key: "marketplace_listings",
    type: "text",
    name: "marketplace-listings",
  }],
  privilegedIntents: ["GuildMembers"],
};

describe("DiscordManagementDashboard", () => {
  beforeEach(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Response.json({
          disposition: "accepted",
          status: "pending",
        }, { status: 202 });
      }
      return Response.json(diagnostics);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders accessible aggregate states without arbitrary mutation fields", async () => {
    render(<DiscordManagementDashboard />);
    expect(await screen.findByRole("heading", { name: "Discord Management" }))
      .toBeTruthy();
    expect(screen.getByRole("status", { name: "Integration status: healthy" }))
      .toBeTruthy();
    expect(screen.getByText("Connected identities")).toBeTruthy();
    expect(screen.getByText("Guild Members intent is mandatory. Registered commands never mutate listings."))
      .toBeTruthy();
    expect(screen.getByText(/Monitoring and reconciliation only/)).toBeTruthy();
    expect(screen.getByText(/Seller approvals, role decisions/)).toBeTruthy();
    expect(screen.queryByLabelText(/channel id|message id|user id|cooldown reset/i))
      .toBeNull();
    const control = screen.getByRole("button", {
      name: "Reconcile managed resources, commands, and content",
    });
    expect(control.className).toContain("min-h-11");
  });

  it("requires confirmation and shows accepted rather than completed", async () => {
    render(<DiscordManagementDashboard />);
    await screen.findByRole("heading", { name: "Discord Management" });
    fireEvent.click(screen.getByRole("button", {
      name: "Reconcile managed resources, commands, and content",
    }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Confirm and enqueue" });
    expect(document.activeElement).toBe(confirm);
    fireEvent.click(confirm);
    expect(await screen.findByText(
      "Reconciliation was accepted and is pending Railway processing.",
    )).toBeTruthy();
    const fetchMock = vi.mocked(fetch);
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post?.[1]?.body).toContain("reconcile_managed_integration");
    expect(post?.[1]?.body).not.toMatch(/channelId|messageId|userId|cooldown/i);
  });

  it("pauses polling while hidden and refreshes when visible", async () => {
    vi.useFakeTimers();
    render(<DiscordManagementDashboard />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
