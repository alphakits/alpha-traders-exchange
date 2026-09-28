import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    sessionStorage.clear();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Response.json({
          action: "reconcile_managed_integration",
          disposition: "accepted",
          status: "pending",
          acceptedAt: diagnostics.generatedAt,
          resultCode: null,
        }, { status: 202 });
      }
      return Response.json(diagnostics);
    }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function flush() {
    await act(async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); });
  }

  it.each(["fetch", "body"])("recovers from a stalled %s without an endless loading screen", async (phase) => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementationOnce(() => phase === "fetch"
      ? new Promise<Response>(() => {})
      : Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) } as Response));
    render(<DiscordManagementDashboard />);
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(screen.getByRole("heading", { name: "Discord Management is unavailable" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();
    expect(screen.getByRole("heading", { name: "Discord Management" })).toBeTruthy();
  });

  it("clears private diagnostics on revoked access without waiting for an error body", async () => {
    vi.useFakeTimers();
    render(<DiscordManagementDashboard />);
    await flush();
    expect(screen.getByText("Connected identities")).toBeTruthy();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false, status: 403, json: () => new Promise(() => {}),
    } as Response);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.queryByText("Connected identities")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reconcile managed resources, commands, and content" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the same request after an uncertain reconciliation and a remount", async () => {
    vi.useFakeTimers();
    const bodies: string[] = [];
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method !== "POST") return Response.json(diagnostics);
      bodies.push(String(init.body));
      if (bodies.length === 1) return new Promise<Response>(() => {});
      return Response.json({ action: "reconcile_managed_integration", disposition: "replayed", status: "completed", acceptedAt: diagnostics.generatedAt, resultCode: null });
    });
    const first = render(<DiscordManagementDashboard />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Reconcile managed resources, commands, and content" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and enqueue" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getByText(/not confirmed/i)).toBeTruthy();
    expect(bodies).toHaveLength(1);
    first.unmount();
    render(<DiscordManagementDashboard />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Reconcile managed resources|Retry previous request/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and enqueue" }));
    await flush();
    expect(bodies).toHaveLength(2);
    expect(JSON.parse(bodies[0]).idempotencyKey).toBe(JSON.parse(bodies[1]).idempotencyKey);
    expect(screen.getByText("The original request is Completed.")).toBeTruthy();
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

  it("preserves the last valid diagnostics when a nested payload is malformed", async () => {
    vi.useFakeTimers();
    render(<DiscordManagementDashboard />);
    await flush();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...diagnostics, database: {} }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByText("Connected identities")).toBeTruthy();
    expect(screen.getByText(/last confirmed state is preserved/i)).toBeTruthy();
  });

  it("rejects an incomplete acknowledgment and reuses the pending request", async () => {
    const bodies: string[] = [];
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      if (init?.method !== "POST") return Response.json(diagnostics);
      bodies.push(String(init.body));
      return Response.json({ disposition: "accepted", status: "pending" }, { status: 202 });
    });
    render(<DiscordManagementDashboard />);
    await screen.findByRole("heading", { name: "Discord Management" });
    for (let attempt = 0; attempt < 2; attempt++) {
      fireEvent.click(screen.getByRole("button", { name: "Reconcile managed resources, commands, and content" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirm and enqueue" }));
      await flush();
      expect(screen.getByText(/not confirmed/i)).toBeTruthy();
    }
    expect(bodies).toHaveLength(2);
    expect(JSON.parse(bodies[0]).idempotencyKey).toBe(JSON.parse(bodies[1]).idempotencyKey);
  });

  it("does not send a reconciliation when its recovery key cannot be saved", async () => {
    render(<DiscordManagementDashboard />);
    await screen.findByRole("heading", { name: "Discord Management" });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("unavailable"); });
    fireEvent.click(screen.getByRole("button", { name: "Reconcile managed resources, commands, and content" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and enqueue" }));
    await flush();
    expect(screen.getByText(/No new request was sent/i)).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("clears private state immediately on sign-out and ignores a late action result", async () => {
    let resolvePost!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(async (_url, init) => init?.method === "POST"
      ? new Promise<Response>(resolve => { resolvePost = resolve; }) : Response.json(diagnostics));
    render(<DiscordManagementDashboard />);
    await screen.findByRole("heading", { name: "Discord Management" });
    fireEvent.click(screen.getByRole("button", { name: "Reconcile managed resources, commands, and content" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and enqueue" }));
    act(() => window.dispatchEvent(new Event("alpha-auth-signed-out")));
    resolvePost(Response.json({ action: "reconcile_managed_integration", disposition: "accepted", status: "pending", acceptedAt: diagnostics.generatedAt, resultCode: null }));
    await flush();
    expect(screen.queryByText("Connected identities")).toBeNull();
    expect(screen.queryByText(/Reconciliation was accepted/i)).toBeNull();
    expect(screen.getByText(/Access is no longer available/i)).toBeTruthy();
  });

  it("releases the action busy state when its locale changes during submission", async () => {
    let resolvePost!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(async (_url, init) => init?.method === "POST"
      ? new Promise<Response>(resolve => { resolvePost = resolve; }) : Response.json(diagnostics));
    const view = render(<DiscordManagementDashboard />);
    await screen.findByRole("heading", { name: "Discord Management" });
    fireEvent.click(screen.getByRole("button", { name: "Reconcile managed resources, commands, and content" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and enqueue" }));
    view.rerender(<DiscordManagementDashboard locale="ar" />);
    resolvePost(Response.json({ action: "reconcile_managed_integration", disposition: "accepted", status: "pending", acceptedAt: diagnostics.generatedAt, resultCode: null }));
    await flush();
    expect((screen.getByRole("button", { name: "مطابقة الموارد والأوامر والمحتوى المُدار" }) as HTMLButtonElement).disabled).toBe(false);
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

  it("renders the operator controls and raw states in Arabic", async () => {
    render(<DiscordManagementDashboard locale="ar" />);

    expect(await screen.findByRole("heading", { name: "إدارة Discord" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "حالة التكامل: سليم" })).toBeTruthy();
    expect(screen.getByText("الحسابات المتصلة")).toBeTruthy();
    expect(screen.getByText("صلاحية Guild Members إلزامية. الأوامر المسجّلة لا تعدّل العروض أبدًا.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "مطابقة الموارد والأوامر والمحتوى المُدار" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Discord Management" })).toBeNull();
  });
});
