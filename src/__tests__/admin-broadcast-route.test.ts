import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiOwner: vi.fn(),
  broadcastNotificationByAdmin: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireApiOwner: mocks.requireApiOwner,
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  broadcastNotificationByAdmin: mocks.broadcastNotificationByAdmin,
}));

import { POST } from "@/app/api/alpha-exchange/admin/notifications/broadcast/route";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/alpha-exchange/admin/notifications/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin emergency broadcast route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiOwner.mockResolvedValue({
      user: { id: "owner-1", role: "owner" },
      unauthorized: null,
    });
    mocks.broadcastNotificationByAdmin.mockResolvedValue(undefined);
  });

  it("rejects an incomplete language pair", async () => {
    const response = await POST(request({
      titleEn: "Scheduled maintenance",
      bodyEn: "Trading will pause briefly.",
      titleAr: "",
      bodyAr: "سيتوقف التداول لفترة قصيرة.",
      type: "warning",
      reason: "Operational notice",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "English and Arabic titles and bodies are required." });
    expect(mocks.broadcastNotificationByAdmin).not.toHaveBeenCalled();
  });

  it("submits both language editions to the store", async () => {
    const response = await POST(request({
      titleEn: "Scheduled maintenance",
      bodyEn: "Trading will pause briefly.",
      titleAr: "صيانة مجدولة",
      bodyAr: "سيتوقف التداول لفترة قصيرة.",
      type: "warning",
      reason: "Operational notice",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.broadcastNotificationByAdmin).toHaveBeenCalledWith({
      actorUserId: "owner-1",
      titleEn: "Scheduled maintenance",
      bodyEn: "Trading will pause briefly.",
      titleAr: "صيانة مجدولة",
      bodyAr: "سيتوقف التداول لفترة قصيرة.",
      type: "warning",
      reason: "Operational notice",
    });
  });
});
