import type { AlphaExchangeDb, AlphaExchangeUser, MarketplaceListing } from "@/types/alpha-exchange";
import type { MarketSnapshot } from "@/types/market";
import type { DemandTerms } from "@/types/usdt-demand";

export const DEMAND_TEST_WALLET = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
export function demandTestUser(id: string, seller = false): AlphaExchangeUser {
  const now = new Date().toISOString();
  return { id, fullName: `Private ${id}`, email: `${id}@example.test`, passwordHash: "fixture-only", whatsappNumber: "+972500000001",
    role: seller ? "approved_seller" : "buyer", roles: ["buyer", ...(seller ? ["approved_seller" as const] : [])], sellerStatus: seller ? "approved_seller" : "buyer",
    availabilityStatus: "available", onlineStatus: "online", createdAt: now, updatedAt: now, preferredNetworks: ["TRC20"], preferredPaymentMethods: ["Bank Transfer"],
    profilePhotoUrl: "", languages: ["English", "Arabic"], bio: "", country: "Israel", city: "Haifa", emailVerified: true,
    verifiedPhone: "+972500000001", phoneVerifiedAt: now, ageEligibility: { method: "self_attestation_v1", confirmedAt: now },
    notificationPreferences: { inApp: true, email: true, sms: false }, onboardingSelection: "buyer", onboardingCompletedAt: now,
    sellerBankAccounts: seller ? [{ id: `bank-${id}`, sellerId: id, accountHolderName: "Test Seller", bankName: "Bank Hapoalim", branchNumber: "123", accountNumber: "100000001", accountLast4: "0001", isDefault: true, createdAt: now, updatedAt: now }] : [],
  };
}
export function demandTestListing(sellerId: string, paymentMethod = "Bank Transfer"): MarketplaceListing {
  const now = new Date().toISOString();
  return { id: `listing-${sellerId}`, sellerId, sellerDisplayName: sellerId, photos: [], originalAmount: "10000", availableAmount: "10000", price: "3.20", currency: "ILS", network: "TRC20",
    paymentMethod, paymentMethods: [paymentMethod], bankAccountId: `bank-${sellerId}`, bankName: "Bank Hapoalim", minimumTrade: "100", maximumTrade: "10000",
    sellerDescription: "Offline fixture", responseTime: "5 min", status: "active", approvalStatus: "approved", createdAt: now, updatedAt: now,
    expiresAt: new Date(Date.now() + 48 * 3600_000).toISOString() };
}
export function demandTestDb(): AlphaExchangeDb & { __runtimeVersion: number } {
  return { users: [demandTestUser("buyer"), demandTestUser("buyer-two"), demandTestUser("seller", true), demandTestUser("seller-two", true)],
    marketplaceListings: [demandTestListing("seller"), demandTestListing("seller-two")], usdtDemands: [], purchaseRequests: [], sellerApplications: [], commissionRecords: [], auditLogs: [],
    authSessions: [], passwordResetTokens: [], notifications: [], activityLog: [], disputes: [], sellerReports: [], trustSnapshots: [], trustScoreHistory: [], tradeEvidenceFiles: [],
    privateBetaInvites: [], privateBetaInviteUses: [], betaFeedback: [], betaAnnouncements: [], adminAnnouncementRuns: [], sellerReviews: [], smsDeliveries: [], marketplaceEnforcementRecords: [], marketplaceEnforcementAuditLog: [], __runtimeVersion: 0 };
}
export function demandTestMarket(price = 3.2, ageMs = 0): MarketSnapshot {
  const now = Date.now() - ageMs;
  const pair = { key: "usdtIls" as const, label: "USDT/ILS", price, changePercent: 0, source: "WISE:USDILS", reference: "WISE:USDILS", quotedAt: new Date(now).toISOString(), validUntil: new Date(now + 120_000).toISOString(), quoteStatus: "live" as const };
  return { status: "live", updatedAt: new Date(now).toISOString(), stale: false, unavailablePairs: [], pairs: { usdtIls: pair, btcUsdt: { ...pair, key: "btcUsdt" }, ethUsdt: { ...pair, key: "ethUsdt" } } };
}
export function demandTestTerms(): DemandTerms { return { amount: "1000", price: "3.20", network: "TRC20", paymentMethod: "Bank Transfer", city: "" }; }
