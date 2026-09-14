import { beforeEach, expect, it, vi } from "vitest";
import { hasRole } from "@/lib/roles";
import { getSellerApplicationEligibility } from "@/lib/seller-application-eligibility";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";

const loadSnapshot = vi.fn();
const loadUnpaidCommissionSellerIds = vi.fn(async () => [] as string[]);
vi.mock("@/lib/alpha-exchange-repository", () => ({
  getAlphaExchangeRepository: vi.fn(async () => ({
    loadSnapshot,
    loadUnpaidCommissionSellerIds,
    saveSnapshot: vi.fn(),
  })),
}));
import { consumeEmailVerificationToken, createEmailVerificationTokenForUser, createSellerApplication, findUserById, getMarketplaceListings, getSellerApplicationByUserId, invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
beforeEach(() => {
  invalidateAlphaExchangeStoreCache();
  loadSnapshot.mockReset();
  loadUnpaidCommissionSellerIds.mockClear();
});
const base = (user: Record<string, unknown>, applications: unknown[] = []) => ({ users: [user], sellerApplications: applications, marketplaceListings: [], purchaseRequests: [], commissionRecords: [], auditLogs: [], authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [] } as unknown as AlphaExchangeDb);
const pending = (userId: string, status = "pending") => ({ id: `app-${userId}`, userId, status, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
const legacy = (id = "edge") => ({ id, email: `${id}@example.test`, fullName: id, role: "pending_seller_approval", roles: ["pending_seller_approval"], sellerStatus: "pending_seller_approval", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

function orphan(id = "orphan") {
  return {
    ...legacy(id),
    onboardingSelection: "seller_applicant",
    onboardingCompletedAt: new Date().toISOString(),
  };
}

it("restores buyer membership for a persisted legacy pending seller applicant", async () => {
  const now = new Date().toISOString();
  loadSnapshot.mockResolvedValue({ users: [{ id: "legacy", email: "legacy@example.test", fullName: "Legacy", role: "pending_seller_approval", roles: ["pending_seller_approval"], sellerStatus: "pending_seller_approval", createdAt: now, updatedAt: now }], sellerApplications: [{ id: "app", userId: "legacy", status: "pending", createdAt: now, updatedAt: now }], marketplaceListings: [], purchaseRequests: [], commissionRecords: [], auditLogs: [], authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [], privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [] } as unknown as AlphaExchangeDb);
  const user = await findUserById("legacy");
  expect(user?.roles).toEqual(expect.arrayContaining(["buyer", "pending_seller_approval"]));
  expect(hasRole(user!, "buyer")).toBe(true);
  expect(hasRole(user!, "approved_seller")).toBe(false);
  expect(getSellerApplicationEligibility({ isCanonicalUserLoading: false, canonicalUserError: false, canonicalUser: user!, application: { status: "pending" }, applicationSubmitted: false })).toBe("application_pending");
});

it("keeps modern pending membership without duplication", async () => { const u = { ...legacy("modern"), roles: ["buyer", "pending_seller_approval"] }; loadSnapshot.mockResolvedValue(base(u, [pending("modern")])); const r = await findUserById("modern"); expect(r?.roles.filter((x) => x === "buyer")).toHaveLength(1); expect(r?.sellerStatus).toBe("pending_seller_approval"); });
it("fails closed for absent persisted email verification while retaining explicit verification", async () => {
  const unmarked = { ...legacy("email-unmarked"), role: "buyer", roles: ["buyer"], sellerStatus: "buyer" };
  loadSnapshot.mockResolvedValue(base(unmarked));
  expect((await findUserById("email-unmarked"))?.emailVerified).toBe(false);

  invalidateAlphaExchangeStoreCache();
  const verified = { ...legacy("email-verified"), role: "buyer", roles: ["buyer"], sellerStatus: "buyer", emailVerified: true };
  loadSnapshot.mockResolvedValue(base(verified));
  expect((await findUserById("email-verified"))?.emailVerified).toBe(true);
});
it("verifies only the matching legacy local account with a single-use store token", async () => {
  const localUser = { ...legacy("local-email"), role: "buyer", roles: ["buyer"], sellerStatus: "buyer", emailVerified: false, passwordHash: "legacy-password-hash" };
  const otherUser = { ...legacy("other-email"), role: "buyer", roles: ["buyer"], sellerStatus: "buyer", emailVerified: false };
  loadSnapshot.mockResolvedValue({ ...base(localUser), users: [localUser, otherUser] });

  const issued = await createEmailVerificationTokenForUser("local-email");
  expect((await consumeEmailVerificationToken(issued.token)).status).toBe("verified");
  expect((await findUserById("local-email"))?.emailVerified).toBe(true);
  expect((await findUserById("other-email"))?.emailVerified).toBe(false);
  expect((await consumeEmailVerificationToken(issued.token)).status).toBe("invalid");
});
it("does not normalize without a matching pending application", async () => { loadSnapshot.mockResolvedValue(base(legacy())); expect(hasRole((await findUserById("edge"))!, "buyer")).toBe(false); });
it("does not normalize another user's application", async () => { loadSnapshot.mockResolvedValue(base(legacy(), [pending("other")])); expect(hasRole((await findUserById("edge"))!, "buyer")).toBe(false); });
it("does not normalize rejected applications", async () => { loadSnapshot.mockResolvedValue(base(legacy(), [pending("edge", "rejected")])); expect(hasRole((await findUserById("edge"))!, "buyer")).toBe(false); });
it("preserves approved sellers", async () => { const u = { ...legacy("approved"), role: "approved_seller", roles: ["buyer", "approved_seller"], sellerStatus: "approved_seller" }; loadSnapshot.mockResolvedValue(base(u)); const r = await findUserById("approved"); expect(hasRole(r!, "approved_seller")).toBe(true); expect(r?.sellerStatus).toBe("approved_seller"); });

it("repairs cardless support for an approved seller's existing bank listing", async () => {
  const now = new Date().toISOString();
  const seller = {
    ...legacy("approved-cardless"),
    role: "approved_seller",
    roles: ["buyer", "approved_seller"],
    sellerStatus: "approved_seller",
    availabilityStatus: "available",
  };
  const application = {
    ...pending("approved-cardless", "approved"),
    preferredNetworks: ["USDT (BEP20)", "Cardless Withdrawal"],
  };
  const listing = {
    id: "listing-approved-cardless",
    sellerId: "approved-cardless",
    sellerDisplayName: "Approved Cardless Seller",
    photos: [],
    originalAmount: "700",
    availableAmount: "700",
    price: "3.22",
    currency: "ILS",
    network: "BEP20",
    paymentMethod: "Bank Transfer",
    paymentMethods: ["Bank Transfer", "Face-to-Face (Meet in Person)"],
    bankName: "Bank Hapoalim",
    minimumTrade: "50",
    maximumTrade: "700",
    sellerDescription: "Available now",
    responseTime: "5 min",
    status: "active",
    approvalStatus: "approved",
    createdAt: now,
    updatedAt: now,
  };
  loadSnapshot.mockResolvedValue({
    ...base(seller, [application]),
    marketplaceListings: [listing],
  } as unknown as AlphaExchangeDb);

  const normalizedSeller = await findUserById("approved-cardless");
  const [normalizedListing] = await getMarketplaceListings("active");

  expect(normalizedSeller?.preferredPaymentMethods).toContain("Cardless ATM Withdrawal");
  expect(normalizedListing.paymentMethods).toEqual([
    "Bank Transfer",
    "Face-to-Face (Meet in Person)",
    "Cardless ATM Withdrawal",
  ]);
});

it("repairs a configured Bank Hapoalim listing when legacy submission lost only cardless", async () => {
  const now = new Date().toISOString();
  const seller = {
    ...legacy("legacy-hapoalim-cardless"),
    role: "approved_seller",
    roles: ["buyer", "approved_seller"],
    sellerStatus: "approved_seller",
    availabilityStatus: "available",
    preferredPaymentMethods: ["Bank Transfer", "Face-to-Face (Meet in Person)"],
  };
  const listing = {
    id: "listing-legacy-hapoalim-cardless",
    sellerId: "legacy-hapoalim-cardless",
    sellerDisplayName: "Legacy Hapoalim Seller",
    photos: [],
    originalAmount: "700",
    availableAmount: "700",
    price: "3.22",
    currency: "ILS",
    network: "BEP20",
    paymentMethod: "Bank Transfer",
    paymentMethods: ["Bank Transfer", "Face-to-Face (Meet in Person)"],
    bankName: "Bank Hapoalim",
    minimumTrade: "50",
    maximumTrade: "700",
    sellerDescription: "Available now",
    responseTime: "5 min",
    status: "active",
    approvalStatus: "approved",
    createdAt: now,
    updatedAt: now,
  };
  loadSnapshot.mockResolvedValue({
    ...base(seller),
    marketplaceListings: [listing],
  } as unknown as AlphaExchangeDb);

  const normalizedSeller = await findUserById("legacy-hapoalim-cardless");
  const [normalizedListing] = await getMarketplaceListings("active");

  expect(normalizedSeller?.preferredPaymentMethods).toContain("Cardless ATM Withdrawal");
  expect(normalizedListing.paymentMethods).toEqual([
    "Bank Transfer",
    "Face-to-Face (Meet in Person)",
    "Cardless ATM Withdrawal",
  ]);
});

it("does not add cardless to an intentionally bank-only listing", async () => {
  const now = new Date().toISOString();
  const seller = {
    ...legacy("bank-only"),
    role: "approved_seller",
    roles: ["buyer", "approved_seller"],
    sellerStatus: "approved_seller",
    availabilityStatus: "available",
    preferredPaymentMethods: ["Bank Transfer"],
  };
  const listing = {
    id: "listing-bank-only",
    sellerId: "bank-only",
    sellerDisplayName: "Bank Only Seller",
    photos: [],
    originalAmount: "700",
    availableAmount: "700",
    price: "3.22",
    currency: "ILS",
    network: "BEP20",
    paymentMethod: "Bank Transfer",
    paymentMethods: ["Bank Transfer"],
    bankName: "Bank Hapoalim",
    minimumTrade: "50",
    maximumTrade: "700",
    sellerDescription: "Available now",
    responseTime: "5 min",
    status: "active",
    approvalStatus: "approved",
    createdAt: now,
    updatedAt: now,
  };
  loadSnapshot.mockResolvedValue({
    ...base(seller),
    marketplaceListings: [listing],
  } as unknown as AlphaExchangeDb);

  const normalizedSeller = await findUserById("bank-only");
  const [normalizedListing] = await getMarketplaceListings("active");

  expect(normalizedSeller?.preferredPaymentMethods).toEqual(["Bank Transfer"]);
  expect(normalizedListing.paymentMethods).toEqual(["Bank Transfer"]);
});

it("recovers the exact orphaned legacy seller applicant to Buyer/reapply", async () => {
  loadSnapshot.mockResolvedValue(base(orphan()));

  const user = await findUserById("orphan");

  expect(user?.role).toBe("buyer");
  expect(user?.roles).toEqual(["buyer"]);
  expect(user?.sellerStatus).toBe("buyer");
  expect(user?.onboardingSelection).toBe("seller_applicant");
  expect(user?.onboardingCompletedAt).toBeTruthy();
  expect(getSellerApplicationEligibility({
    isCanonicalUserLoading: false,
    canonicalUserError: false,
    canonicalUser: user!,
    application: null,
    applicationSubmitted: false,
  })).toBe("application_available");
});

it("lets a recovered orphan submit a real fresh pending application", async () => {
  loadSnapshot.mockResolvedValue(base(orphan()));

  expect((await findUserById("orphan"))?.sellerStatus).toBe("buyer");
  const application = await createSellerApplication({
    userId: "orphan",
    fullName: "Recovered Applicant",
    email: "orphan@example.test",
    whatsappNumber: "+972501234567",
    preferredNetworks: ["USDT (ERC20 / Ethereum)"],
    expectedMonthlyTradingVolume: "1000",
    additionalNotes: "Fresh application after recovery",
  });
  const user = await findUserById("orphan");

  expect(application.status).toBe("pending");
  expect((await getSellerApplicationByUserId("orphan"))?.id).toBe(application.id);
  expect(user?.sellerStatus).toBe("pending_seller_approval");
  expect(user?.roles).toEqual(expect.arrayContaining(["buyer", "pending_seller_approval"]));
  expect(hasRole(user!, "approved_seller")).toBe(false);
});

it.each(["pending", "rejected", "approved"])("does not recover an orphan candidate when a same-user %s application exists", async (status) => {
  loadSnapshot.mockResolvedValue(base(orphan(), [pending("orphan", status)]));

  const user = await findUserById("orphan");

  expect(user?.role).toBe("pending_seller_approval");
  expect(user?.sellerStatus).toBe("pending_seller_approval");
  if (status === "pending") {
    expect(user?.roles).toEqual(expect.arrayContaining(["buyer", "pending_seller_approval"]));
  } else {
    expect(user?.roles).toEqual(["pending_seller_approval"]);
  }
});

it("does not recover a pending user without seller-applicant onboarding", async () => {
  const user = orphan();
  delete user.onboardingSelection;
  loadSnapshot.mockResolvedValue(base(user));

  expect((await findUserById("orphan"))?.sellerStatus).toBe("pending_seller_approval");
});

it("does not recover a pending user without onboarding completion", async () => {
  const user = orphan();
  delete user.onboardingCompletedAt;
  loadSnapshot.mockResolvedValue(base(user));

  expect((await findUserById("orphan"))?.sellerStatus).toBe("pending_seller_approval");
});

it("does not recover owner, privileged, suspended, or disabled account shapes", async () => {
  const cases = [
    { ...orphan("owner"), email: "jozenmark834@yahoo.com" },
    { ...orphan("admin"), roles: ["pending_seller_approval", "admin"] },
    { ...orphan("approved"), role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller" },
    { ...orphan("suspended"), sellerStatus: "suspended" },
    { ...orphan("disabled"), disabled: true },
  ];

  for (const candidate of cases) {
    invalidateAlphaExchangeStoreCache();
    loadSnapshot.mockResolvedValue(base(candidate));
    const user = await findUserById(candidate.id);
    expect(user?.sellerStatus).not.toBe("buyer");
  }
});
