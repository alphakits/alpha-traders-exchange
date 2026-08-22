import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

vi.mock("@/lib/postgres-runtime", () => ({
  getRuntimePostgresPool: () => null,
}));

import {
  addSellerBankAccount,
  closePurchaseRequestManually,
  createMarketplaceListing,
  deleteSellerBankAccount,
  getMarketplaceListings,
  getTradeRoomData,
  getTradeRoomBankDetails,
  invalidateAlphaExchangeStoreCache,
  runAlphaExchangeMaintenance,
  updatePurchaseRequestStatus,
} from "@/lib/alpha-exchange-store";

const SELLER_ID = "seller-1";
const BUYER_ID = "buyer-1";
const OUTSIDER_ID = "outsider-1";

function createUser(id: string, role: "approved_seller" | "buyer" | "admin") {
  const now = new Date().toISOString();
  return {
    id,
    fullName: id,
    email: `${id}@example.com`,
    passwordHash: "hash",
    whatsappNumber: "+972500000000",
    role,
    roles: role === "admin" ? ["admin", "buyer"] : [role],
    sellerStatus: role === "approved_seller" ? "approved_seller" : "buyer",
    availabilityStatus: "available",
    onlineStatus: "online",
    createdAt: now,
    updatedAt: now,
    preferredNetworks: ["TRC20"],
    preferredPaymentMethods: ["Bank Transfer"],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    country: "Israel",
    city: "",
    coverBannerUrl: "",
    isFeaturedSeller: false,
    isProfileHidden: false,
    notificationPreferences: { inApp: true, email: false, sms: false },
    emailVerified: true,
    emailVerifiedAt: now,
    verifiedPhone: "+972500000000",
    phoneVerifiedAt: now,
    lifetimeCompletedVolumeUsdt: 0,
    sellerPrestigeRank: "bronze",
    sellerPromotionHistory: [],
    sellerAchievements: [],
  };
}

function seedDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return {
    users: [
      createUser(SELLER_ID, "approved_seller"),
      createUser(BUYER_ID, "buyer"),
      createUser(OUTSIDER_ID, "buyer"),
    ] as AlphaExchangeDb["users"],
    sellerApplications: [],
    marketplaceListings: [],
    purchaseRequests: [],
    commissionRecords: [],
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

function currentSnapshot() {
  return globalThis.__alphaExchangeMemorySnapshot as unknown as AlphaExchangeDb;
}

describe("seller bank accounts and trade guardrails", () => {
  beforeEach(() => {
    globalThis.__alphaExchangeMemorySnapshot = seedDb() as never;
    globalThis.__alphaExchangeMemoryEvidenceContent = undefined as never;
    globalThis.__alphaExchangeRepositoryPromise = undefined as never;
    invalidateAlphaExchangeStoreCache();
  });

  it("enforces max 2 bank accounts and blocks deleting linked active listing account", async () => {
    const first = await addSellerBankAccount({
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      accountHolderName: "Seller One",
      bankName: "Bank Hapoalim",
      branchNumber: "123",
      accountNumber: "1234567890",
      isDefault: true,
    });

    await addSellerBankAccount({
      sellerId: SELLER_ID,
      actorUserId: SELLER_ID,
      accountHolderName: "Seller One",
      bankName: "Bank Leumi",
      branchNumber: "456",
      accountNumber: "9876543210",
      isDefault: false,
    });

    await expect(
      addSellerBankAccount({
        sellerId: SELLER_ID,
        actorUserId: SELLER_ID,
        accountHolderName: "Seller One",
        bankName: "Discount",
        branchNumber: "888",
        accountNumber: "1111222233",
      }),
    ).rejects.toThrow("You can save up to 2 bank accounts.");

    await createMarketplaceListing({
      sellerId: SELLER_ID,
      sellerDisplayName: "Seller One",
      availableAmount: "1000",
      price: "3.10",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      bankAccountId: first.id,
      bankName: "Bank Hapoalim",
      minimumTrade: "100",
      maximumTrade: "1000",
      responseTime: "5 min",
      acceptedCommissionPolicy: true,
      actorUserId: SELLER_ID,
    });

    await expect(
      deleteSellerBankAccount({
        sellerId: SELLER_ID,
        actorUserId: SELLER_ID,
        bankAccountId: first.id,
      }),
    ).rejects.toThrow("linked to active trades or listings");
  });

  it("reveals bank details only to trade participants after accept and logs reveal once in short window", async () => {
    const now = new Date().toISOString();
    const snapshot = currentSnapshot();
    const seller = snapshot.users.find((user) => user.id === SELLER_ID);
    if (!seller) throw new Error("seller fixture missing");

    (seller as { sellerBankAccounts?: unknown[] }).sellerBankAccounts = [
      {
        id: "bank-1",
        sellerId: SELLER_ID,
        accountHolderName: "Seller One",
        bankName: "Bank Hapoalim",
        branchNumber: "123",
        accountNumber: "1234567890",
        accountLast4: "7890",
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
    ];

    snapshot.purchaseRequests.push({
      id: "req-1",
      listingId: "listing-1",
      buyerId: BUYER_ID,
      buyerName: "Buyer",
      buyerWhatsapp: "+972500000000",
      buyerNotes: "",
      sellerId: SELLER_ID,
      usdtAmount: "250",
      fiatAmount: "900",
      currency: "ILS",
      network: "TRC20",
      paymentMethod: "Bank Transfer",
      status: "accepted",
      sellerBankAccountId: "bank-1",
      timeline: [],
      createdAt: now,
      updatedAt: now,
    } as never);

    const firstReveal = await getTradeRoomBankDetails({
      purchaseRequestId: "req-1",
      actorUserId: BUYER_ID,
      actorRole: "buyer",
    });
    expect(firstReveal.accountNumber).toBe("1234567890");

    await getTradeRoomBankDetails({
      purchaseRequestId: "req-1",
      actorUserId: BUYER_ID,
      actorRole: "buyer",
    });

    const request = currentSnapshot().purchaseRequests.find((item) => item.id === "req-1");
    const revealEvents = (request?.timeline ?? []).filter((event) => event.type === "bank_details_revealed");
    expect(revealEvents).toHaveLength(1);

    await expect(
      getTradeRoomBankDetails({
        purchaseRequestId: "req-1",
        actorUserId: OUTSIDER_ID,
        actorRole: "buyer",
      }),
    ).rejects.toThrow("not allowed");
  });

  it("scrubs legacy seller profile contact data from both Trade Room participant responses", async () => {
    const now = new Date().toISOString();
    const snapshot = currentSnapshot();
    snapshot.marketplaceListings.push({
      id: "listing-contact-legacy",
      sellerId: SELLER_ID,
      sellerDisplayName: "Seller One",
      photos: [],
      originalAmount: "1000",
      availableAmount: "750",
      price: "3.10",
      currency: "ILS",
      network: "TRC20",
      paymentMethod: "Bank Transfer",
      paymentMethods: ["Bank Transfer"],
      minimumTrade: "100",
      maximumTrade: "1000",
      sellerDescription: "Legacy listing",
      responseTime: "5 min",
      status: "matched",
      sellerProfile: {
        sellerId: SELLER_ID,
        sellerName: "Seller One",
        profilePhotoUrl: "",
        memberSince: now,
        languages: ["English"],
        preferredNetworks: ["TRC20"],
        bio: "",
        onlineStatus: "online",
        availabilityStatus: "available",
        contact: { email: "seller-private@example.test", phone: "+972501234567" },
      },
      createdAt: now,
      updatedAt: now,
    } as never);
    snapshot.purchaseRequests.push({
      id: "request-contact-legacy",
      listingId: "listing-contact-legacy",
      buyerId: BUYER_ID,
      sellerId: SELLER_ID,
      buyerName: "Buyer",
      buyerWhatsapp: "+972509999999",
      buyerNotes: "buyer-private@example.test",
      usdtAmount: "250",
      fiatAmount: "775",
      currency: "ILS",
      network: "TRC20",
      paymentMethod: "Bank Transfer",
      status: "accepted",
      timeline: [],
      createdAt: now,
      updatedAt: now,
    } as never);

    for (const actor of [
      [BUYER_ID, "buyer"],
      [SELLER_ID, "approved_seller"],
    ] as const) {
      const room = await getTradeRoomData({
        purchaseRequestId: "request-contact-legacy",
        actorUserId: actor[0],
        actorRole: actor[1],
      });
      const serialized = JSON.stringify(room);
      expect(serialized).not.toContain("seller-private@example.test");
      expect(serialized).not.toContain("+972501234567");
      expect(serialized).not.toContain("buyer-private@example.test");
      expect(serialized).not.toContain("+972509999999");
    }
  });

  it("sends inactivity warning without auto-close, dedupes warning, and clears warning once status changes", async () => {
    const snapshot = currentSnapshot();
    const staleTime = new Date(Date.now() - 16 * 60 * 1000).toISOString();

    snapshot.marketplaceListings.push({
      id: "listing-2",
      sellerId: SELLER_ID,
      sellerName: "Seller One",
      title: "Listing",
      price: "3.10",
      currency: "ILS",
      availableAmount: "1000",
      minimumTrade: "100",
      maximumTrade: "1000",
      network: "TRC20",
      status: "matched",
      activeTradeRequestId: "req-2",
      createdAt: staleTime,
      updatedAt: staleTime,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    } as never);

    snapshot.purchaseRequests.push({
      id: "req-2",
      listingId: "listing-2",
      buyerId: BUYER_ID,
      buyerName: "Buyer",
      buyerWhatsapp: "+972500000000",
      buyerNotes: "",
      sellerId: SELLER_ID,
      usdtAmount: "200",
      fiatAmount: "620",
      currency: "ILS",
      network: "TRC20",
      paymentMethod: "Bank Transfer",
      status: "accepted",
      timeline: [],
      createdAt: staleTime,
      updatedAt: staleTime,
    } as never);

    await getMarketplaceListings();
    await getMarketplaceListings();

    const warned = currentSnapshot().purchaseRequests.find((item) => item.id === "req-2");
    expect(warned?.status).toBe("accepted");
    expect(Boolean(warned?.inactivityWarningSentAt)).toBe(true);
    const warningEvents = (warned?.timeline ?? []).filter((event) => event.type === "trade_inactivity_warning_sent");
    expect(warningEvents).toHaveLength(1);

    currentSnapshot().tradeEvidenceFiles.push({
      id: "evidence-req-2",
      purchaseRequestId: "req-2",
      side: "buyer",
      uploadedByUserId: BUYER_ID,
      uploadedAt: staleTime,
      fileName: "payment.png",
      mimeType: "image/png",
      sizeBytes: 1024,
      storagePath: "testing/req-2/payment.png",
      status: "uploaded",
    });

    await updatePurchaseRequestStatus({
      requestId: "req-2",
      actorUserId: BUYER_ID,
      actorRole: "buyer",
      nextStatus: "payment_sent",
    });

    const paymentSent = currentSnapshot().purchaseRequests.find((item) => item.id === "req-2");
    expect(paymentSent?.status).toBe("payment_sent");
    expect(paymentSent?.inactivityWarningSentAt).toBeUndefined();
  });

  it("allows manual close before seller acceptance and blocks a second close mutation", async () => {
    const now = new Date().toISOString();
    const snapshot = currentSnapshot();
    snapshot.purchaseRequests.push({
      id: "req-close",
      listingId: "listing-close",
      buyerId: BUYER_ID,
      buyerName: "Buyer",
      buyerWhatsapp: "+972500000000",
      buyerNotes: "",
      sellerId: SELLER_ID,
      usdtAmount: "100",
      fiatAmount: "320",
      currency: "ILS",
      network: "TRC20",
      paymentMethod: "Bank Transfer",
      status: "pending",
      timeline: [],
      createdAt: now,
      updatedAt: now,
    } as never);

    const closed = await closePurchaseRequestManually({
      requestId: "req-close",
      actorUserId: BUYER_ID,
      actorRole: "buyer",
      reason: "Counterparty unavailable",
      explanation: "No response in chat.",
    });

    expect(closed.status).toBe("cancelled");
    expect(closed.closeReason).toBe("Counterparty unavailable");
    expect(closed).not.toHaveProperty("buyerWhatsapp");
    expect(closed).not.toHaveProperty("buyerNotes");

    await expect(
      closePurchaseRequestManually({
        requestId: "req-close",
        actorUserId: BUYER_ID,
        actorRole: "buyer",
        reason: "Second close",
      }),
    ).resolves.toMatchObject({ status: "cancelled" });
  });

  it("blocks manual close immediately after acceptance and throughout the irreversible lifecycle", async () => {
    const now = new Date().toISOString();
    for (const status of ["accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"] as const) {
      const requestId = `req-irreversible-${status}`;
      currentSnapshot().purchaseRequests.push({
        id: requestId,
        listingId: `listing-${requestId}`,
        buyerId: BUYER_ID,
        buyerName: "Buyer",
        buyerWhatsapp: "+972500000000",
        buyerNotes: "",
        sellerId: SELLER_ID,
        usdtAmount: "100",
        fiatAmount: "320",
        currency: "ILS",
        network: "TRC20",
        paymentMethod: "Bank Transfer",
        status,
        timeline: [],
        createdAt: now,
        updatedAt: now,
      } as never);

      await expect(
        closePurchaseRequestManually({
          requestId,
          actorUserId: status === "usdt_sent" ? SELLER_ID : BUYER_ID,
          actorRole: status === "usdt_sent" ? "approved_seller" : "buyer",
          reason: "Attempted cancellation",
        }),
      ).rejects.toThrow("cannot be closed manually after seller acceptance");
    }
  });

  it("rejects buyer cancellation through the canonical status endpoint after acceptance", async () => {
    const now = new Date().toISOString();
    for (const status of ["accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"] as const) {
      const requestId = `req-cancel-locked-${status}`;
      currentSnapshot().purchaseRequests.push({
        id: requestId,
        listingId: `listing-${requestId}`,
        buyerId: BUYER_ID,
        buyerName: "Buyer",
        buyerWhatsapp: "+972500000000",
        buyerNotes: "",
        sellerId: SELLER_ID,
        usdtAmount: "100",
        fiatAmount: "320",
        currency: "ILS",
        network: "TRC20",
        paymentMethod: "Bank Transfer",
        status,
        timeline: [],
        createdAt: now,
        updatedAt: now,
      } as never);

      await expect(
        updatePurchaseRequestStatus({
          requestId,
          actorUserId: BUYER_ID,
          actorRole: "buyer",
          nextStatus: "cancelled",
        }),
      ).rejects.toMatchObject({ code: "invalid-status-transition" });
    }
  });

  it("auto-completes an expired USDT receipt window idempotently", async () => {
    const sentAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    const snapshot = currentSnapshot();
    snapshot.marketplaceListings.push({
      id: "listing-expired-receipt",
      sellerId: SELLER_ID,
      sellerDisplayName: "Seller One",
      photos: [],
      originalAmount: "1000",
      availableAmount: "1000",
      price: "3.20",
      currency: "ILS",
      network: "TRC20",
      paymentMethods: ["Bank Transfer"],
      paymentMethod: "Bank Transfer",
      bankName: "Bank Hapoalim",
      minimumTrade: "50",
      maximumTrade: "1000",
      status: "in_trade",
      activeTradeRequestId: "req-expired-receipt",
      createdAt: sentAt,
      updatedAt: sentAt,
    } as never);
    snapshot.purchaseRequests.push({
      id: "req-expired-receipt",
      listingId: "listing-expired-receipt",
      buyerId: BUYER_ID,
      buyerName: "Buyer",
      buyerWhatsapp: "+972500000000",
      buyerNotes: "",
      sellerId: SELLER_ID,
      usdtAmount: "100",
      fiatAmount: "320",
      currency: "ILS",
      network: "TRC20",
      paymentMethod: "Bank Transfer",
      status: "usdt_sent",
      usdtSentAt: sentAt,
      timeline: [],
      createdAt: sentAt,
      updatedAt: sentAt,
    } as never);

    await runAlphaExchangeMaintenance();
    const completed = currentSnapshot().purchaseRequests.find((item) => item.id === "req-expired-receipt");
    expect(completed?.status).toBe("review_open");
    expect(completed?.completedAt).toBeTruthy();
    expect(currentSnapshot().commissionRecords.filter((item) => item.purchaseRequestId === "req-expired-receipt")).toHaveLength(1);
    expect(currentSnapshot().marketplaceListings.find((item) => item.id === "listing-expired-receipt")?.activeTradeRequestId).toBeUndefined();

    await runAlphaExchangeMaintenance();
    expect(currentSnapshot().commissionRecords.filter((item) => item.purchaseRequestId === "req-expired-receipt")).toHaveLength(1);
  });
});
