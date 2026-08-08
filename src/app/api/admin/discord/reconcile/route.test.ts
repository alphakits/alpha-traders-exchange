import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiAdmin: vi.fn(),
  enqueueDiscordOperatorReconciliation: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({
  requireApiAdmin: mocks.requireApiAdmin,
}));
vi.mock("@/lib/discord/management", () => ({
  enqueueDiscordOperatorReconciliation:
    mocks.enqueueDiscordOperatorReconciliation,
}));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));

import { POST } from "@/app/api/admin/discord/reconcile/route";

function request(
  body: unknown,
  options: { origin?: string; userId?: string } = {},
) {
  return new NextRequest("http://localhost/api/admin/discord/reconcile", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: options.origin ?? "http://localhost",
      "sec-fetch-site": "same-origin",
      "x-test-user": options.userId ?? crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

function validBody() {
  return {
    confirmation: "reconcile_managed_integration",
    idempotencyKey: crypto.randomUUID(),
  };
}

describe("Discord reconciliation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiAdmin.mockResolvedValue({
      user: { id: crypto.randomUUID(), role: "admin" },
      unauthorized: null,
    });
    mocks.enqueueDiscordOperatorReconciliation.mockResolvedValue({
      disposition: "accepted",
      status: "pending",
      acceptedAt: "2026-08-08T06:00:00.000Z",
      resultCode: null,
    });
  });

  it("denies unauthenticated, buyer, and seller actors", async () => {
    for (const status of [401, 403, 403]) {
      mocks.requireApiAdmin.mockResolvedValueOnce({
        user: null,
        unauthorized: NextResponse.json({ error: "Denied" }, { status }),
      });
      const response = await POST(request(validBody()));
      expect(response.status).toBe(status);
    }
    expect(mocks.enqueueDiscordOperatorReconciliation).not.toHaveBeenCalled();
  });

  it("allows admin and owner actors with a same-origin explicit confirmation", async () => {
    for (const role of ["admin", "owner"]) {
      const userId = crypto.randomUUID();
      mocks.requireApiAdmin.mockResolvedValueOnce({
        user: { id: userId, role },
        unauthorized: null,
      });
      const response = await POST(request(validBody()));
      const payload = await response.json();
      expect(response.status).toBe(202);
      expect(payload).toMatchObject({
        action: "reconcile_managed_integration",
        disposition: "accepted",
        status: "pending",
      });
      expect(mocks.enqueueDiscordOperatorReconciliation).toHaveBeenLastCalledWith(
        expect.objectContaining({ actorUserId: userId }),
      );
    }
  });

  it("rejects cross-origin requests and arbitrary mutation inputs", async () => {
    const crossOrigin = await POST(request(validBody(), {
      origin: "https://attacker.example",
    }));
    expect(crossOrigin.status).toBe(403);

    for (const body of [
      { ...validBody(), channelId: "5".repeat(18) },
      { ...validBody(), userId: "5".repeat(18) },
      { ...validBody(), messageId: "5".repeat(18) },
      { ...validBody(), cooldownReset: true },
      { ...validBody(), confirmation: "delete_message" },
    ]) {
      mocks.requireApiAdmin.mockResolvedValueOnce({
        user: { id: crypto.randomUUID(), role: "admin" },
        unauthorized: null,
      });
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }
    expect(mocks.enqueueDiscordOperatorReconciliation).not.toHaveBeenCalled();
  });

  it("surfaces coalesced processing instead of fake completion", async () => {
    mocks.enqueueDiscordOperatorReconciliation.mockResolvedValue({
      disposition: "coalesced",
      status: "processing",
      acceptedAt: "2026-08-08T06:00:00.000Z",
      resultCode: null,
    });

    const response = await POST(request(validBody()));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      disposition: "coalesced",
      status: "processing",
    });
  });

  it("returns the original terminal result for an idempotency replay", async () => {
    mocks.enqueueDiscordOperatorReconciliation.mockResolvedValue({
      disposition: "replayed",
      status: "completed",
      acceptedAt: "2026-08-08T06:00:00.000Z",
      resultCode: "reconciliation_completed",
    });
    const response = await POST(request(validBody()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      disposition: "replayed",
      status: "completed",
      resultCode: "reconciliation_completed",
    });
  });

  it("rate limits repeated operator actions before persistence", async () => {
    const actorUserId = crypto.randomUUID();
    mocks.requireApiAdmin.mockResolvedValue({
      user: { id: actorUserId, role: "admin" },
      unauthorized: null,
    });
    for (let index = 0; index < 3; index += 1) {
      expect((await POST(request(validBody()))).status).toBe(202);
    }
    const limited = await POST(request(validBody()));
    expect(limited.status).toBe(429);
    expect(mocks.enqueueDiscordOperatorReconciliation).toHaveBeenCalledTimes(3);
  });

  it("fails closed when the durable request cannot be persisted", async () => {
    mocks.enqueueDiscordOperatorReconciliation.mockRejectedValue(
      new Error("database failed"),
    );
    const response = await POST(request(validBody()));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "The reconciliation request could not be persisted.",
      code: "request_persistence_failed",
    });
  });
});
