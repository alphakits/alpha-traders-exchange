// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rate: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiOwner: mocks.auth }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.rate }));
vi.mock("@/lib/commission-receipt-review", () => ({ readOwnerCommissionReceipts: mocks.read }));
import { GET } from "./route";
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "owner" }, unauthorized: null }); mocks.rate.mockResolvedValue({ allowed: true }); mocks.read.mockResolvedValue({ receipts: [], discoveryOnly: true }); });
for (const status of [401, 403, 503]) it(`preserves owner authorization ${status} without reading private history`, async () => {
  mocks.auth.mockResolvedValue({ user: null, unauthorized: NextResponse.json({ error: "unavailable" }, { status }) });
  expect((await GET(new NextRequest("https://alpha.test/api/admin/commission-receipts"))).status).toBe(status); expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.rate).not.toHaveBeenCalled();
});
it("serves noncacheable nonindexable owner-only discovery", async () => { const result = await GET(new NextRequest("https://alpha.test/api/admin/commission-receipts")); expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store"); expect(result.headers.get("x-robots-tag")).toBe("noindex"); });
it("rate limits provider polling without fetching", async () => { mocks.rate.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 }); const result = await GET(new NextRequest("https://alpha.test/api/admin/commission-receipts")); expect(result.status).toBe(429); expect(mocks.read).not.toHaveBeenCalled(); });
it("does not expose storage credentials on error", async () => { mocks.read.mockRejectedValue(new Error("postgres-password-here")); const result = await GET(new NextRequest("https://alpha.test/api/admin/commission-receipts")); expect(result.status).toBe(503); expect(await result.text()).not.toContain("postgres-password-here"); });
