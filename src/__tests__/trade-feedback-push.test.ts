// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import type { AlphaExchangeDb, AlphaExchangeNotification } from "@/types/alpha-exchange";

const mocks = vi.hoisted(() => ({ repository: vi.fn(), native: vi.fn(), browser: vi.fn(), realtime: vi.fn(), room: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/alpha-exchange-repository", async (original) => ({ ...await original<typeof import("@/lib/alpha-exchange-repository")>(), getAlphaExchangeRepository: mocks.repository }));
vi.mock("@/lib/mobile-push", async (original) => ({ ...await original<typeof import("@/lib/mobile-push")>(), scheduleMobilePushDelivery: mocks.native }));
vi.mock("@/lib/browser-push", async (original) => ({ ...await original<typeof import("@/lib/browser-push")>(), scheduleBrowserPushDelivery: mocks.browser }));
vi.mock("@/lib/whatsapp-notifications", async (original) => ({ ...await original<typeof import("@/lib/whatsapp-notifications")>(), scheduleWhatsAppNotificationDelivery: vi.fn() }));
vi.mock("@/lib/realtime", () => ({ publishRealtimeEvent: mocks.realtime }));
vi.mock("@/lib/alpha-exchange-store", async (original) => ({ ...await original<typeof import("@/lib/alpha-exchange-store")>(), getTradeRoomData: mocks.room }));
vi.mock("@/lib/api-auth", () => ({ requireApiUser: async () => ({ user: { id: "seller", role: "approved_seller" } }), requireMarketplaceVerificationForTrading: () => null }));
vi.mock("@/lib/mobile-api-auth", () => ({ requireMobileApiUser: async () => ({ user: { id: "seller", role: "approved_seller" } }) }));
vi.mock("@/lib/rate-limit", () => ({ checkSharedRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: vi.fn() }));

import { AlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { invalidateAlphaExchangeStoreCache, submitBuyerTradeReview, submitSellerBuyerReview, submitSellerReviewResponse } from "@/lib/alpha-exchange-store";
import { browserPushCategoryEnabled, browserPushPayload } from "@/lib/browser-push";
import { privacySafeMobilePushCopy } from "@/lib/mobile-push";
import { POST as websiteReview } from "@/app/api/alpha-exchange/purchase-requests/[requestId]/review/route";
import { POST as nativeReview } from "@/app/api/mobile/v1/trades/[requestId]/review/route";

const input = { requestId: "feedback-trade", sellerUserId: "seller", rating: 5, comment: "Private feedback text" };
const at = "2026-11-01T10:00:00.000Z";
function seed() {
  return {
    users: ["buyer", "seller", "outsider"].map(id => ({ id, fullName: id, email: `${id}@example.test`, role: id === "seller" ? "approved_seller" : "buyer", roles: [id === "seller" ? "approved_seller" : "buyer"], sellerStatus: id === "seller" ? "approved_seller" : "buyer", notificationPreferences: { inApp: true, browserPush: true, email: false, sms: false }, createdAt: at, updatedAt: at })),
    purchaseRequests: [{ id: input.requestId, tradeId: "trade-reference", buyerId: "buyer", sellerId: "seller", buyerName: "Buyer", listingId: "listing", status: "completed", network: "TRC20", paymentMethod: "Bank Transfer", currency: "ILS", usdtAmount: "100", fiatAmount: "330", createdAt: at, completedAt: at, updatedAt: at, messages: [], timeline: [] }],
    sellerApplications: [], marketplaceListings: [], commissionRecords: [], auditLogs: [], authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [], __runtimeVersion: 0,
  } as unknown as AlphaExchangeDb & { __runtimeVersion: number };
}
function snapshot() { return globalThis.__alphaExchangeMemorySnapshot as unknown as ReturnType<typeof seed>; }
function reset(db = seed()) {
  globalThis.__alphaExchangeMemorySnapshot = db as never;
  invalidateAlphaExchangeStoreCache();
}
function assertFeedback(notice: AlphaExchangeNotification, userId: string) {
  expect(notice).toMatchObject({ userId, category: "review", centerCategory: "reviews", relatedRequestId: input.requestId, relatedHref: "/trade-room/feedback-trade", actionHref: "/trade-room/feedback-trade" });
  expect(browserPushCategoryEnabled(notice, { browserPush: true, browserPushFeedback: false })).toBe(false);
  expect(browserPushCategoryEnabled(notice, { browserPush: true, browserPushTradeUpdates: false })).toBe(true);
  expect(browserPushPayload(notice, "ar").url).toBe("/ar/trade-room/feedback-trade");
  for (const locale of ["en", "ar"] as const) {
    expect(JSON.stringify(privacySafeMobilePushCopy(notice, locale))).not.toContain(input.comment);
    expect(JSON.stringify(browserPushPayload(notice, locale))).not.toContain(input.comment);
  }
}
let repository: AlphaExchangeRepository;
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks();
  reset(); repository = new AlphaExchangeRepository(null); mocks.repository.mockResolvedValue(repository);
  mocks.room.mockImplementation(async () => ({ request: snapshot().purchaseRequests[0], listing: null, messages: [], counterpart: {}, poke: {}, hasOpenDispute: false }));
});
afterEach(() => { vi.restoreAllMocks(); });

describe("committed trade feedback alerts", () => {
  it.each(["service", "website", "native"] as const)("alerts only the buyer after a %s seller review commits", async (path) => {
    mocks.native.mockImplementation((notice: AlphaExchangeNotification) => {
      expect(snapshot().purchaseRequests[0].sellerBuyerReview?.comment).toBe(input.comment);
      expect(snapshot().notifications.some(item => item.id === notice.id)).toBe(true);
    });
    if (path === "service") await submitSellerBuyerReview(input);
    else {
      const request = new NextRequest("https://www.alphatraders.co.il/api/review", { method: "POST", headers: { "content-type": "application/json", "x-app-version": "1.2.0", "x-device-id": "feedback-test-device", "x-platform": "ios" }, body: JSON.stringify({ mode: "seller_buyer_review", rating: input.rating, comment: input.comment, sellerUserId: "outsider", buyerId: "outsider" }) });
      const response = await (path === "website" ? websiteReview : nativeReview)(request, { params: Promise.resolve({ requestId: input.requestId }) });
      expect(response.status).toBe(200);
    }
    expect(snapshot().notifications).toHaveLength(1);
    assertFeedback(snapshot().notifications[0], "buyer");
    expect(mocks.native).toHaveBeenCalledTimes(1);
    expect(mocks.browser).toHaveBeenCalledTimes(1);
  });

  it("makes identical retries a no-op and rejects a changed review", async () => {
    await submitSellerBuyerReview(input);
    await submitSellerBuyerReview(input);
    await expect(submitSellerBuyerReview({ ...input, comment: "Changed" })).rejects.toThrow("already submitted");
    expect(snapshot().notifications).toHaveLength(1);
    expect(mocks.native).toHaveBeenCalledTimes(1);
    expect(mocks.browser).toHaveBeenCalledTimes(1);
  });

  it("does not publish or persist a notice when saving fails", async () => {
    vi.spyOn(repository, "saveSnapshot").mockRejectedValueOnce(new Error("Save failed"));
    await expect(submitSellerBuyerReview(input)).rejects.toThrow("Save failed");
    expect(snapshot().notifications).toHaveLength(0);
    expect(snapshot().purchaseRequests[0].sellerBuyerReview).toBeUndefined();
    expect(mocks.native).not.toHaveBeenCalled(); expect(mocks.browser).not.toHaveBeenCalled();
  });

  it("discards speculative publication when a concurrent identical review wins the fallback rebase", async () => {
    await submitSellerBuyerReview(input);
    const winner = structuredClone(snapshot());
    reset(); mocks.native.mockClear(); mocks.browser.mockClear();
    const save = repository.saveSnapshot.bind(repository);
    vi.spyOn(repository, "saveSnapshot").mockImplementationOnce(async (db, options) => {
      reset({ ...winner, __runtimeVersion: snapshot().__runtimeVersion + 1 });
      return save(db, options);
    });
    await submitSellerBuyerReview(input);
    expect(snapshot().notifications).toHaveLength(1);
    expect(mocks.native).not.toHaveBeenCalled(); expect(mocks.browser).not.toHaveBeenCalled();
  });

  it("respects optional in-app consent for seller feedback", async () => {
    snapshot().users[0].notificationPreferences!.inApp = false;
    await submitSellerBuyerReview(input);
    expect(snapshot().purchaseRequests[0].sellerBuyerReview).toBeDefined();
    expect(snapshot().notifications).toHaveLength(0);
    expect(mocks.native).not.toHaveBeenCalled(); expect(mocks.browser).not.toHaveBeenCalled();
  });

  it("routes buyer reviews and seller replies to their trade under the feedback preference", async () => {
    await submitBuyerTradeReview({ requestId: input.requestId, buyerUserId: "buyer", rating: 5, comment: input.comment });
    const buyerNotice = snapshot().notifications.find(item => item.title === "Buyer left a review")!;
    assertFeedback(buyerNotice, "seller");
    await submitSellerReviewResponse({ requestId: input.requestId, sellerUserId: "seller", message: input.comment });
    const replyNotice = snapshot().notifications.find(item => item.title === "Seller replied to your review")!;
    assertFeedback(replyNotice, "buyer");
    const count = mocks.native.mock.calls.length;
    await submitSellerReviewResponse({ requestId: input.requestId, sellerUserId: "seller", message: input.comment });
    expect(mocks.native).toHaveBeenCalledTimes(count);
  });

  it.each([false, true])("persists the notice in the focused transaction before publication (failure=%s)", async (failCommit) => {
    const canonical = seed();
    let committed = false;
    const query = vi.fn(async (...parameters: [string, unknown[]?]) => {
      const [sql] = parameters;
      if (sql.includes("as target_id")) return { rows: [{ target_id: input.requestId, payload: structuredClone(canonical) }] };
      if (sql === "commit") { if (failCommit) throw new Error("Commit failed"); committed = true; }
      return { rows: [] };
    });
    const focused = new AlphaExchangeRepository({ query: vi.fn(), connect: async () => ({ query, release: vi.fn() }), on: vi.fn() } as unknown as Pool);
    vi.spyOn(focused, "ensureReady").mockResolvedValue(undefined);
    mocks.repository.mockResolvedValue(focused);
    mocks.native.mockImplementation(() => { expect(committed).toBe(true); });
    if (failCommit) await expect(submitSellerBuyerReview(input)).rejects.toThrow("Commit failed");
    else await submitSellerBuyerReview(input);
    const insertion = query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO alpha_exchange.notifications"));
    expect(insertion).toBeDefined();
    const notices = (insertion![1]![6] as string[]).map(value => JSON.parse(value) as AlphaExchangeNotification);
    expect(notices).toHaveLength(1); assertFeedback(notices[0], "buyer");
    expect(mocks.native).toHaveBeenCalledTimes(failCommit ? 0 : 1);
    if (failCommit) expect(query.mock.calls.some(([sql]) => sql === "rollback")).toBe(true);
  });
});
