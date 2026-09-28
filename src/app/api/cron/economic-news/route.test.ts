import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
const sync = vi.hoisted(() => vi.fn());
vi.mock("@/lib/economic-news/worker", () => ({ runEconomicNewsSync: sync }));
import { GET } from "./route";

describe("economic news scheduler authorization", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
  it("rejects unconfigured and unauthorized calls without running a news job", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(new NextRequest("https://example.test/api/cron/economic-news"))).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "test-cron-secret-with-at-least-32-characters");
    expect((await GET(new NextRequest("https://example.test/api/cron/economic-news"))).status).toBe(401);
    expect(sync).not.toHaveBeenCalled();
  });
  it("runs an authorized job and returns no provider credentials on an outage", async () => {
    const secret = "test-cron-secret-with-at-least-32-characters";
    vi.stubEnv("CRON_SECRET", secret);
    sync.mockRejectedValueOnce(new Error("secret provider URL"));
    const response = await GET(new NextRequest("https://example.test/api/cron/economic-news", { headers: { Authorization: `Bearer ${secret}` } }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});
