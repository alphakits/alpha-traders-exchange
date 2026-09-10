// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  runAlphaExchangeMaintenance: vi.fn(),
  runTradeActionReminders: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  runAlphaExchangeMaintenance: mocks.runAlphaExchangeMaintenance,
  runTradeActionReminders: mocks.runTradeActionReminders,
}));

import { GET } from "@/app/api/cron/trade-action-reminders/route";

const SECRET = "test-cron-secret-that-is-at-least-32-characters";

function request(authorization?: string) {
  return new NextRequest("https://www.alphatraders.co.il/api/cron/trade-action-reminders", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("hourly trade action reminder cron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.runAlphaExchangeMaintenance.mockResolvedValue({ changed: false });
    mocks.runTradeActionReminders.mockResolvedValue({
      activeTradesChecked: 2,
      notificationsCreated: 1,
      emailsSent: 1,
      emailFailures: 0,
    });
  });

  it("fails closed when the server secret is absent or too short", async () => {
    vi.stubEnv("CRON_SECRET", "short");

    const response = await GET(request("Bearer short"));

    expect(response.status).toBe(503);
    expect(mocks.runTradeActionReminders).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong bearer secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    const response = await GET(request("Bearer wrong-secret"));

    expect(response.status).toBe(401);
    expect(mocks.runTradeActionReminders).not.toHaveBeenCalled();
  });

  it("runs the sweep for Vercel's authenticated request without caching", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    const response = await GET(request(`Bearer ${SECRET}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      ok: true,
      maintenanceChanged: false,
      activeTradesChecked: 2,
      notificationsCreated: 1,
      emailsSent: 1,
      emailFailures: 0,
    });
    expect(mocks.runAlphaExchangeMaintenance).toHaveBeenCalledTimes(1);
    expect(mocks.runTradeActionReminders).toHaveBeenCalledTimes(1);
  });

  it("checks every five minutes while each trade remains limited to one reminder per hour", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));

    expect(config.crons).toEqual([
      {
        path: "/api/cron/trade-action-reminders",
        schedule: "*/5 * * * *",
      },
    ]);
  });
});
