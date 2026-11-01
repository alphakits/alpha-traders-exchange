import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  sendMarketplaceEmail: vi.fn(),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/server")>(), after: mocks.after,
}));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/marketplace-email-delivery", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/marketplace-email-delivery")>(),
  sendMarketplaceEmail: mocks.sendMarketplaceEmail,
}));

import {
  invalidateAlphaExchangeStoreCache,
  recoverPendingCommissionPaymentConfirmationEmails,
  updateCommissionPaymentStatus,
} from "@/lib/alpha-exchange-store";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";

const SELLER_ID = "commission-seller";
const BUYER_ID = "commission-buyer";
const COMMISSION_ID = "commission-1";

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  const now = new Date().toISOString();
  return {
    users: [
      {
        id: SELLER_ID,
        fullName: "Commission Seller",
        email: "commission-seller@example.test",
        passwordHash: "hash",
        whatsappNumber: "",
        role: "approved_seller",
        roles: ["approved_seller"],
        sellerStatus: "approved_seller",
        availabilityStatus: "available",
        onlineStatus: "online",
        createdAt: now,
        updatedAt: now,
        preferredNetworks: [],
        preferredPaymentMethods: [],
        profilePhotoUrl: "",
        languages: ["English"],
        bio: "",
        country: "Israel",
        isFeaturedSeller: false,
        isProfileHidden: false,
        notificationPreferences: { inApp: true, email: false, sms: false },
      },
    ] as AlphaExchangeDb["users"],
    sellerApplications: [],
    marketplaceListings: [],
    purchaseRequests: [],
    commissionRecords: [{
      id: COMMISSION_ID,
      purchaseRequestId: "request-1",
      listingId: "listing-1",
      sellerId: SELLER_ID,
      buyerId: BUYER_ID,
      rate: 0.01,
      grossAmount: 500,
      commissionAmount: 5,
      paymentStatus: "pending",
      createdAt: now,
      updatedAt: now,
    }],
    auditLogs: [],
    authSessions: [],
    passwordResetTokens: [],
    notifications: [],
    activityLog: [],
    disputes: [],
    sellerReports: [],
    trustSnapshots: [],
    trustScoreHistory: [],
    tradeEvidenceFiles: [],
    privateBetaInvites: [],
    privateBetaInviteUses: [],
    betaFeedback: [],
    betaAnnouncements: [],
    adminAnnouncementRuns: [],
    sellerReviews: [],
    __runtimeVersion: 0,
  };
}


function snapshot() {
  return globalThis.__alphaExchangeMemorySnapshot as AlphaExchangeDb;
}
function currentCommission() {
  return snapshot().commissionRecords.find((record) => record.id === COMMISSION_ID)!;
}
async function settle() {
  return updateCommissionPaymentStatus({
    commissionId: COMMISSION_ID, actorUserId: "owner-1", paymentStatus: "paid",
    reason: "Owner verified receipt.",
  });
}

describe("durable commission confirmation recovery", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
    mocks.after.mockReset(); // Simulates after() accepted but the function died before callback.
    mocks.sendMarketplaceEmail.mockReset().mockResolvedValue({ ok: true, queued: true });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request in recovery test"); }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    invalidateAlphaExchangeStoreCache();
    globalThis.__alphaExchangeMemorySnapshot = undefined as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
  });

  it("recovers a lost deferred callback without repeating settlement or sending historical receipts", async () => {
    snapshot().commissionRecords.push({ ...currentCommission(), id: "historical-paid", paymentStatus: "paid" });
    await settle();
    expect(mocks.sendMarketplaceEmail).not.toHaveBeenCalled();
    expect(currentCommission()).toMatchObject({ paymentStatus: "paid", paymentConfirmationEmailPending: {
      id: expect.any(String), amountDueUsdt: 5, remainingCommissions: [],
    } });
    const auditCount = snapshot().auditLogs.length;
    const notificationCount = snapshot().notifications.length;
    invalidateAlphaExchangeStoreCache(); // A new function instance still sees the committed marker.

    await expect(recoverPendingCommissionPaymentConfirmationEmails()).resolves.toEqual({
      checked: 1, queued: 1, errors: 0, pending: 0, budgetExhausted: false,
    });
    expect(mocks.sendMarketplaceEmail).toHaveBeenCalledOnce();
    expect(mocks.sendMarketplaceEmail).toHaveBeenCalledWith(expect.objectContaining({
      event: "commission_paid", idempotencyKey: `commission-paid:${COMMISSION_ID}:${SELLER_ID}`,
    }));
    expect(currentCommission().paymentConfirmationEmailPending).toBeUndefined();
    expect(snapshot().auditLogs).toHaveLength(auditCount);
    expect(snapshot().notifications).toHaveLength(notificationCount);
    await recoverPendingCommissionPaymentConfirmationEmails();
    expect(mocks.sendMarketplaceEmail).toHaveBeenCalledOnce();
  });

  it("keeps failed/throwing enqueue work pending and retries the identical idempotency key", async () => {
    await settle();
    mocks.sendMarketplaceEmail.mockResolvedValueOnce({ ok: false, reason: "email_storage_unavailable" })
      .mockRejectedValueOnce(new Error("Storage disconnected"));
    await expect(recoverPendingCommissionPaymentConfirmationEmails()).resolves.toMatchObject({ errors: 1, pending: 1 });
    const pendingId = currentCommission().paymentConfirmationEmailPending!.id;
    await expect(recoverPendingCommissionPaymentConfirmationEmails()).resolves.toMatchObject({ errors: 1, pending: 1 });
    expect(currentCommission().paymentConfirmationEmailPending!.id).toBe(pendingId);
    await expect(recoverPendingCommissionPaymentConfirmationEmails()).resolves.toMatchObject({ queued: 1, pending: 0 });
    expect(new Set(mocks.sendMarketplaceEmail.mock.calls.map(([input]) => input.idempotencyKey)).size).toBe(1);
  });

  it("does not send a paid receipt after an owner deliberately reopens the commission", async () => {
    await settle();
    await updateCommissionPaymentStatus({
      commissionId: COMMISSION_ID, actorUserId: "owner-1", paymentStatus: "pending",
      paymentVerificationStatus: "failed", reason: "Receipt belonged to another commission.",
    });
    const callback = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await callback();
    await recoverPendingCommissionPaymentConfirmationEmails();
    expect(mocks.sendMarketplaceEmail).not.toHaveBeenCalled();
    expect(currentCommission().paymentConfirmationEmailPending).toBeUndefined();
    expect(currentCommission().paymentStatus).toBe("pending");
  });

  it("reuses the queued receipt after a crash while clearing its marker", async () => {
    await settle();
    const repository = await getAlphaExchangeRepository();
    mocks.sendMarketplaceEmail.mockImplementationOnce(async () => {
      vi.spyOn(repository, "saveSnapshot").mockRejectedValueOnce(new Error("Process interrupted after durable enqueue"));
      return { ok: true, queued: true };
    });
    await expect(recoverPendingCommissionPaymentConfirmationEmails()).resolves.toMatchObject({ errors: 1, pending: 1 });
    expect(currentCommission().paymentConfirmationEmailPending).toBeDefined();
    invalidateAlphaExchangeStoreCache();
    await expect(recoverPendingCommissionPaymentConfirmationEmails()).resolves.toMatchObject({ queued: 1, pending: 0 });
    expect(mocks.sendMarketplaceEmail.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      `commission-paid:${COMMISSION_ID}:${SELLER_ID}`, `commission-paid:${COMMISSION_ID}:${SELLER_ID}`,
    ]);
    expect(currentCommission().paymentConfirmationEmailPending).toBeUndefined();
  });

  it("does not erase a newer settlement marker when its earlier enqueue finishes", async () => {
    await settle();
    const originalMarker = currentCommission().paymentConfirmationEmailPending!.id;
    mocks.sendMarketplaceEmail.mockImplementationOnce(async () => {
      await updateCommissionPaymentStatus({
        commissionId: COMMISSION_ID, actorUserId: "owner-1", paymentStatus: "pending",
        paymentVerificationStatus: "failed", reason: "Reviewing payment attribution.",
      });
      await settle();
      return { ok: true, queued: true };
    });
    await recoverPendingCommissionPaymentConfirmationEmails();
    expect(currentCommission().paymentStatus).toBe("paid");
    expect(currentCommission().paymentConfirmationEmailPending).toBeDefined();
    expect(currentCommission().paymentConfirmationEmailPending!.id).not.toBe(originalMarker);
  });

  it("respects remaining runtime and leaves the marker for the next scheduled run", async () => {
    await settle();
    await expect(recoverPendingCommissionPaymentConfirmationEmails({ maxDurationMs: 5_000 }))
      .resolves.toEqual({ checked: 0, queued: 0, errors: 0, pending: 1, budgetExhausted: true });
    expect(mocks.sendMarketplaceEmail).not.toHaveBeenCalled();
  });

  it("rotates failed work so a bounded sweep can deliver another seller's receipt", async () => {
    await settle();
    snapshot().commissionRecords.push({
      ...currentCommission(), id: "commission-2",
      paymentConfirmationEmailPending: {
        ...currentCommission().paymentConfirmationEmailPending!, id: "other-pending-marker",
        requestedAt: "2020-01-02T00:00:00.000Z",
      },
    });
    currentCommission().paymentConfirmationEmailPending!.requestedAt = "2020-01-01T00:00:00.000Z";
    invalidateAlphaExchangeStoreCache();
    mocks.sendMarketplaceEmail.mockResolvedValueOnce({ ok: false, reason: "email_recipient_unavailable" });
    await recoverPendingCommissionPaymentConfirmationEmails({ limit: 1 });
    await recoverPendingCommissionPaymentConfirmationEmails({ limit: 1 });
    expect(mocks.sendMarketplaceEmail.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      `commission-paid:${COMMISSION_ID}:${SELLER_ID}`, `commission-paid:commission-2:${SELLER_ID}`,
    ]);
    expect(currentCommission().paymentConfirmationEmailPending).toBeDefined();
    expect(snapshot().commissionRecords.find((record) => record.id === "commission-2")?.paymentConfirmationEmailPending).toBeUndefined();
  });
});
