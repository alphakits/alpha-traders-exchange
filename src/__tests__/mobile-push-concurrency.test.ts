// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => ({ query: mocks.query }) }));

describe("mobile push bursts sharing the financial database pool", () => {
  beforeEach(() => { vi.resetModules(); mocks.query.mockReset(); });

  it("bounds concurrent lookups, drains every notification and releases capacity after a failure", async () => {
    let active = 0;
    let peak = 0;
    const seen: string[] = [];
    const pending: Array<(fail?: boolean) => void> = [];
    mocks.query.mockImplementation(async (sql: string, values?: string[]) => {
      if (!sql.includes("from alpha_exchange.notifications notification")) return { rows: [] };
      seen.push(values![0]);
      active += 1;
      peak = Math.max(peak, active);
      return new Promise((resolve, reject) => pending.push((fail = false) => {
        active -= 1;
        if (fail) reject(new Error("Temporary notification lookup failure"));
        else resolve({ rows: [] });
      }));
    });
    const { deliverMobilePushNotification } = await import("@/lib/mobile-push");
    const deliveries = Array.from({ length: 9 }, (_, index) => deliverMobilePushNotification({
      id: `burst-${index}`, userId: `buyer-${index}`, category: "trade", title: "Trade completed",
      message: "Open your trade", isRead: false, createdAt: "2026-10-18T00:00:00Z",
    } as AlphaExchangeNotification));
    // Observe rejections immediately so the synthetic failure cannot become
    // an unhandled rejection while the rest of the burst is draining.
    const completed = Promise.allSettled(deliveries);
    await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
    const initialPeak = peak;
    let failed = false;
    while (seen.length < 9 || pending.length) {
      const next = pending.shift();
      if (next) { next(!failed); failed = true; }
      await new Promise(resolve => setImmediate(resolve));
    }
    const results = await completed;
    expect(initialPeak).toBeLessThanOrEqual(2);
    expect(peak).toBeLessThanOrEqual(2);
    expect(new Set(seen).size).toBe(9);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(8);
    expect(active).toBe(0);
  });
});
