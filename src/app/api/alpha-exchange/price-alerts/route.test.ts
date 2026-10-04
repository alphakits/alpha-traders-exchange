import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), save: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.auth }));
vi.mock("@/lib/alpha-exchange-store", () => ({ updateMarketplacePriceAlert: mocks.save }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.rate, createRateLimitResponse: () => NextResponse.json({ error: "rate" }, { status: 429, headers: { "Retry-After": "5" } }) }));
import { GET, PATCH } from "./route";
const value = { enabled: true, maxPrice: "3.50", minUsdt: "200", paymentMethod: "Bank Transfer" };
const request = (body: unknown, origin = "http://localhost") => new NextRequest("http://localhost/api/alpha-exchange/price-alerts", { method: "PATCH", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "buyer-a", marketplacePriceAlert: value, email: "private@example.test", passwordHash: "secret" } }); mocks.rate.mockResolvedValue({ allowed: true }); mocks.save.mockResolvedValue(value); });
describe("account-owned price alert API", () => {
  it("returns only the owning account and alert preference with private cache headers", async () => { const response = await GET(); expect(await response.json()).toEqual({ ownerId: "buyer-a", preference: value }); expect(response.headers.get("cache-control")).toBe("private, no-store"); });
  it("uses the authenticated owner when saving", async () => { const response = await PATCH(request(value)); expect(response.status).toBe(200); expect(mocks.save).toHaveBeenCalledWith("buyer-a", value); });
  it("rejects attempts to address another account", async () => { expect((await PATCH(request({ ...value, userId: "buyer-b" }))).status).toBe(400); expect(mocks.save).not.toHaveBeenCalled(); });
  it("rejects cross-origin mutations", async () => { expect((await PATCH(request(value, "https://other.example"))).status).toBe(403); expect(mocks.save).not.toHaveBeenCalled(); });
  it("does not allow anonymous access or cache the authentication response", async () => { mocks.auth.mockImplementation(async () => ({ user: null, unauthorized: NextResponse.json({ error: "unauthorized" }, { status: 401 }) })); for (const response of [await GET(), await PATCH(request(value))]) { expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Cookie"); } });
  it("returns an unconfirmed result on a persistence outage", async () => { mocks.save.mockRejectedValue(new Error("secret database endpoint")); const response = await PATCH(request(value)); expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret database"); });
  it("honors rate limiting without writing or caching the response", async () => { mocks.rate.mockResolvedValue({ allowed: false }); const response = await PATCH(request(value)); expect(response.status).toBe(429); expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("vary")).toBe("Cookie"); expect(response.headers.get("retry-after")).toBe("5"); expect(mocks.save).not.toHaveBeenCalled(); });
});
