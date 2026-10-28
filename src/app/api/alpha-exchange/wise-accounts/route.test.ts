// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), verification: vi.fn(), save: vi.fn(), list: vi.fn(), remove: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.auth, requireMarketplaceVerificationForTrading: mocks.verification }));
vi.mock("@/lib/alpha-exchange-store", () => ({ saveWiseAccount: mocks.save, getWiseAccountsForUser: mocks.list, deleteWiseAccount: mocks.remove }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: mocks.rate }));
import { GET, POST, PATCH } from "./route";
const body = { provider: "wise", currency: "USD", countryCode: "US", accountHolderType: "personal", accountHolderName: "Test Buyer",
  bankName: "Synthetic Bank", routingNumber: "021000021", accountNumber: "00123456789", accountType: "checking" };
const request = (data: unknown, method = "POST") => new NextRequest("http://localhost/api/alpha-exchange/wise-accounts", { method, body: JSON.stringify(data), headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ALPHA_WISE_DRAFT_ENABLED", "1"); vi.stubEnv("ALPHA_EXCHANGE_DATA_BACKEND", "json");
  vi.stubEnv("ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY", "1");
  vi.stubEnv("SUPABASE_DB_URL", ""); vi.stubEnv("DATABASE_URL", "");
  globalThis.__alphaTradersRuntimeDbPool = undefined;
  for (const key of ["VERCEL", "VERCEL_ENV", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_PROJECT_ID"]) vi.stubEnv(key, "");
  mocks.auth.mockResolvedValue({ user: { id: "buyer", emailVerified: true }, unauthorized: null });
  mocks.verification.mockReturnValue(null); mocks.rate.mockResolvedValue({ allowed: true });
  mocks.list.mockResolvedValue([{ id: "account-1", accountLast4: "6789", ownershipReviewStatus: "pending_review" }]);
  mocks.save.mockResolvedValue({ id: "account-1", ownershipReviewStatus: "pending_review" });
});
afterEach(() => vi.unstubAllEnvs());
it("returns an explicit disabled capability without reading account data", async () => {
  vi.stubEnv("ALPHA_WISE_DRAFT_ENABLED", "0");
  const response = await GET();
  expect(await response.json()).toEqual({ enabled: false, mode: "disabled", accounts: [] });
  expect(response.headers.get("cache-control")).toContain("no-store"); expect(mocks.list).not.toHaveBeenCalled();
  expect((await POST(request(body))).status).toBe(403); expect(mocks.save).not.toHaveBeenCalled();
});
it.each(["userId", "ownershipReview", "verified", "reviewedBy"])("rejects client-owned authorization field %s", async key => {
  const response = await POST(request({ ...body, [key]: "forged" }));
  expect(response.status).toBe(400); expect(mocks.save).not.toHaveBeenCalled();
});
it("derives ownership from session and never caches private responses", async () => {
  const response = await POST(request(body));
  expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toContain("no-store");
  expect(mocks.save).toHaveBeenCalledWith({ actorUserId: "buyer", accountId: undefined, details: body });
  expect(await response.json()).not.toHaveProperty("accountNumber");
});
it("requires authentication and current platform verification", async () => {
  mocks.auth.mockResolvedValueOnce({ user: null, unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
  expect((await POST(request(body))).status).toBe(401);
  mocks.verification.mockReturnValue(NextResponse.json({ error: "Verify" }, { status: 403 }));
  expect((await PATCH(request({ ...body, accountId: "account-1" }, "PATCH"))).status).toBe(403);
  expect(mocks.save).not.toHaveBeenCalled();
});
