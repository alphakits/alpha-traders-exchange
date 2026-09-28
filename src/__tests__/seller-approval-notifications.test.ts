// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

const mocks = vi.hoisted(() => ({ send: vi.fn(), push: vi.fn(), log: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/marketplace-email-delivery", () => ({ sendMarketplaceEmail: mocks.send }));
vi.mock("@/lib/mobile-push", () => ({ scheduleMobilePushDelivery: mocks.push }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.log }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));

import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import {
  approveSellerApplicationByAdmin, findUserById, invalidateAlphaExchangeStoreCache,
  sendSellerApprovalEmailByAdmin,
} from "@/lib/alpha-exchange-store";

function seed(approved = false) {
  const now = "2026-09-22T00:00:00.000Z";
  return {
    users: [{
      id: "seller-1", fullName: "Test Seller", email: "current@example.test", passwordHash: "hash",
      whatsappNumber: "", preferredNetworks: [], profilePhotoUrl: "", languages: ["Arabic"],
      preferredLocale: "ar", bio: "", onlineStatus: "offline", availabilityStatus: "available",
      role: approved ? "approved_seller" : "pending_seller_approval",
      roles: ["buyer", approved ? "approved_seller" : "pending_seller_approval"],
      sellerStatus: approved ? "approved_seller" : "pending_seller_approval",
      notificationPreferences: { inApp: false, email: false, sms: false }, createdAt: now, updatedAt: now,
    }],
    sellerApplications: [{
      id: "application-1", userId: "seller-1", fullName: "Old Name", email: "outdated@example.test",
      whatsappNumber: "", preferredNetworks: ["Bank Transfer"], expectedMonthlyTradingVolume: "",
      status: approved ? "approved" : "pending", createdAt: now, updatedAt: now,
    }],
    marketplaceListings: [], purchaseRequests: [], commissionRecords: [], auditLogs: [], authSessions: [],
    passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [],
    trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [],
    privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [],
    __runtimeVersion: 0,
  } as unknown as AlphaExchangeDb;
}

function reset(db = seed()) {
  globalThis.__alphaExchangeMemorySnapshot = db as never;
  globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  invalidateAlphaExchangeStoreCache();
}
function persisted() { return globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb; }

describe("seller approval notices", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    reset();
    mocks.send.mockResolvedValue({ ok: true });
    mocks.after.mockImplementation(() => { throw new Error("No request context"); });
  });

  it("persists approval and an in-app notice before sending localized email and push, even with optional alerts off", async () => {
    const assertCommitted = () => {
      expect(persisted().sellerApplications[0].status).toBe("approved");
      expect(persisted().users[0].sellerStatus).toBe("approved_seller");
      expect(persisted().notifications.some((item) => item.title === "Seller application approved")).toBe(true);
    };
    mocks.send.mockImplementation(async () => { assertCommitted(); return { ok: true }; });
    mocks.push.mockImplementation((notice) => { if (notice.title === "Seller application approved") assertCommitted(); });
    await approveSellerApplicationByAdmin("application-1", "owner-1", "Reviewed");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      event: "seller_application_approved", to: "current@example.test", recipientName: "Test Seller",
      recipientLocale: "ar", actionPath: "/dashboard/seller", idempotencyKey: expect.stringMatching(/^seller-approved:[a-f0-9]{64}$/),
    }));
    expect(mocks.push).toHaveBeenCalledWith(expect.objectContaining({ userId: "seller-1", title: "Seller application approved" }));
  });

  it("does not send an approval notice when persistence fails", async () => {
    await findUserById("seller-1");
    mocks.send.mockClear(); mocks.push.mockClear();
    const repository = await getAlphaExchangeRepository();
    vi.spyOn(repository, "saveSnapshot").mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(approveSellerApplicationByAdmin("application-1", "owner-1", "Reviewed")).rejects.toThrow("Database unavailable");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.push.mock.calls.some(([notice]) => notice.title === "Seller application approved")).toBe(false);
  });

  it.each(["provider-failure", "exception"])("keeps the approval and notice when email returns %s, and allows recovery", async (failure) => {
    if (failure === "exception") mocks.send.mockRejectedValueOnce(new Error("Connection reset"));
    else mocks.send.mockResolvedValueOnce({ ok: false, reason: "resend_request_failed", providerStatus: 503 });
    await expect(approveSellerApplicationByAdmin("application-1", "owner-1", "Reviewed")).resolves.toMatchObject({ status: "approved" });
    const approvalState = structuredClone(persisted());
    await expect(sendSellerApprovalEmailByAdmin("application-1", "owner-1")).resolves.toEqual({ ok: true });
    expect(persisted()).toEqual(approvalState);
    expect(mocks.send.mock.calls[0][0].idempotencyKey).toBe(mocks.send.mock.calls[1][0].idempotencyKey);
    expect(mocks.log).toHaveBeenCalledWith("error", expect.objectContaining({ event: "seller_approval_email", outcome: "failed" }));
  });

  it("rejects duplicate approval without resending or duplicating the in-app notice", async () => {
    await approveSellerApplicationByAdmin("application-1", "owner-1", "Reviewed");
    await expect(approveSellerApplicationByAdmin("application-1", "owner-1", "Again")).rejects.toThrow("no longer pending");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(persisted().notifications.filter((item) => item.title === "Seller application approved")).toHaveLength(1);
  });

  it("can send a missing email for an existing approval without changing access or notifications", async () => {
    reset(seed(true));
    await findUserById("seller-1");
    const before = structuredClone(persisted());
    await expect(sendSellerApprovalEmailByAdmin("application-1", "owner-1")).resolves.toEqual({ ok: true });
    expect(persisted()).toEqual(before);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: "current@example.test" }));
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it.each(["pending", "rejected", "suspended", "disabled", "missing"])("does not send false approval to a %s account", async (state) => {
    const db = seed(true);
    if (state === "pending" || state === "rejected") db.sellerApplications[0].status = state;
    if (state === "suspended") db.users[0].sellerStatus = "suspended";
    if (state === "disabled") db.users[0].disabled = true;
    if (state === "missing") db.users = [];
    reset(db);
    await expect(sendSellerApprovalEmailByAdmin("application-1", "owner-1")).rejects.toThrow("active approved seller");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("schedules delivery after the request and rechecks eligibility before sending", async () => {
    let delivery: (() => Promise<void>) | undefined;
    mocks.after.mockImplementation((callback) => { delivery = callback; });
    await approveSellerApplicationByAdmin("application-1", "owner-1", "Reviewed");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(delivery).toBeTypeOf("function");
    const db = structuredClone(persisted());
    db.users[0].sellerStatus = "suspended";
    reset(db);
    await delivery!();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith("error", expect.objectContaining({ event: "seller_approval_email" }));
  });
});
