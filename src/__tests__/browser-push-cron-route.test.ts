// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ drain: vi.fn() }));
vi.mock("@/lib/browser-push", () => ({ drainBrowserPush: mocks.drain }));
import { GET } from "@/app/api/cron/browser-push/route";
const secret = "notification-cron-test-secret-32-characters";
const request = (token?: string) => new NextRequest("https://www.alphatraders.co.il/api/cron/browser-push", { headers: token ? { authorization: token } : {} });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("CRON_SECRET", secret); mocks.drain.mockResolvedValue({ sent: 2 }); });
afterEach(() => vi.unstubAllEnvs());
it.each([undefined, "", "Bearer invalid", `Bearer ${secret}extra`])("rejects unauthorized recovery %s", async token => {
  expect((await GET(request(token))).status).toBe(401); expect(mocks.drain).not.toHaveBeenCalled();
});
it("fails closed if the scheduler secret is missing", async () => {
  vi.stubEnv("CRON_SECRET", ""); expect((await GET(request())).status).toBe(503); expect(mocks.drain).not.toHaveBeenCalled();
});
it("runs an authorized sweep without caching the response", async () => {
  const response = await GET(request(`Bearer ${secret}`)); expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store"); expect(await response.json()).toEqual({ sent: 2 });
});
it("does not disclose provider or subscription secrets on recovery failure", async () => {
  mocks.drain.mockRejectedValue(new Error("private endpoint/key")); const response = await GET(request(`Bearer ${secret}`));
  expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private endpoint/key");
});
