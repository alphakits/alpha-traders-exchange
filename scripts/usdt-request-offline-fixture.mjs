import { randomBytes, scryptSync } from "node:crypto";

export const OFFLINE_PASSWORD = "OfflineDemo!2026";
export const OFFLINE_ACCOUNTS = {
  buyer: { id: "offline-buyer", email: "buyer@offline.example.test", name: "Demo Buyer" },
  seller: { id: "offline-seller", email: "seller@offline.example.test", name: "Demo Seller" },
  otherSeller: { id: "offline-seller-two", email: "seller-two@offline.example.test", name: "Demo Seller Two" },
  otherBuyer: { id: "offline-buyer-two", email: "buyer-two@offline.example.test", name: "Demo Buyer Two" },
};
export const OFFLINE_HEADERS = { "content-type": "application/json", "x-alpha-test-support": "enabled" };

export async function seedOfflineFixture(baseURL) {
  const url = new URL(baseURL);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Offline fixture target must be HTTP loopback.");
  const health = await fetch(`${baseURL}/__usdt-offline-health`, { signal: AbortSignal.timeout(10_000) });
  const marker = health.ok ? await health.json() : null;
  if (marker?.kind !== "alpha-usdt-offline-preview-v1" || marker.isolated !== true || marker.externalNetworkBlocked !== true) {
    throw new Error("Refusing to reset a server that is not the isolated offline preview.");
  }
  const response = await fetch(`${baseURL}/api/testing/alpha-exchange-state`, { headers: OFFLINE_HEADERS, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Local fixture route failed (${response.status}).`);
  const current = await response.json();
  // Build exclusively from empty collections. Never copy user data from disk.
  const db = Object.fromEntries(["users", "sellerApplications", "marketplaceListings", "purchaseRequests", "commissionRecords",
    "auditLogs", "authSessions", "passwordResetTokens", "notifications", "activityLog", "disputes", "sellerReports",
    "trustSnapshots", "trustScoreHistory", "tradeEvidenceFiles", "tradeMessages", "privateBetaInvites", "privateBetaInviteUses",
    "betaFeedback", "betaAnnouncements", "adminAnnouncementRuns", "sellerReviews", "smsDeliveries",
    "marketplaceEnforcementRecords", "marketplaceEnforcementAuditLog"].map(key => [key, []]));
  const now = new Date().toISOString();
  db.__runtimeVersion = current.__runtimeVersion;
  db.usdtDemands = [];
  db.users = Object.entries(OFFLINE_ACCOUNTS).map(([key, account], index) => {
    const seller = key === "seller" || key === "otherSeller";
    const salt = randomBytes(16).toString("hex");
    return {
      id: account.id, fullName: account.name, email: account.email,
      passwordHash: `${salt}:${scryptSync(OFFLINE_PASSWORD, salt, 64).toString("hex")}`,
      role: seller ? "approved_seller" : "buyer", roles: seller ? ["approved_seller", "buyer"] : ["buyer"],
      sellerStatus: seller ? "approved_seller" : "buyer", preferredLocale: "en",
      sellerApprovalVerification: seller ? { method: "manual_authorized_reviewer_v1", identityDocumentReviewed: true,
        liveIdentityVideoReviewed: true, contactOwnershipConfirmed: true, marketplaceRulesAccepted: true,
        verifiedAt: now, verifiedByUserId: "offline-reviewer" } : undefined,
      whatsappNumber: `+97250000900${index}`, verifiedPhone: `+97250000900${index}`, phoneVerifiedAt: now,
      emailVerified: true, emailVerifiedAt: now, buyerVerificationStatus: "verified", buyerFirstName: "Demo",
      buyerLastName: seller ? "Seller" : "Buyer", buyerDisplayName: account.name,
      ageEligibility: { method: "self_attestation_v1", confirmedAt: now },
      onboardingSelection: seller ? "seller_applicant" : "buyer", onboardingCompletedAt: now,
      onlineStatus: "online", availabilityStatus: "available", isProfileHidden: false, isFoundingSeller: seller,
      notificationPreferences: { inApp: true, email: false, sms: false },
      preferredNetworks: ["TRC20"], preferredPaymentMethods: ["Bank Transfer"], profilePhotoUrl: "",
      languages: ["English", "Arabic"], bio: "Synthetic offline preview account", country: "Israel", city: "Haifa",
      sellerBankAccounts: seller ? [{ id: `bank-${account.id}`, sellerId: account.id, accountHolderName: account.name,
        bankName: "Bank Hapoalim", branchNumber: "123", accountNumber: `90000900${index}`, accountLast4: `900${index}`,
        isDefault: true, createdAt: now, updatedAt: now }] : [], createdAt: now, updatedAt: now,
    };
  });
  db.marketplaceListings = [OFFLINE_ACCOUNTS.seller, OFFLINE_ACCOUNTS.otherSeller].map(account => ({
    id: `listing-${account.id}`, sellerId: account.id, sellerDisplayName: account.name, photos: [],
    originalAmount: "10000", availableAmount: "10000", price: "3.30", currency: "ILS", network: "TRC20",
    paymentMethod: "Bank Transfer", paymentMethods: ["Bank Transfer", "Cardless ATM Withdrawal", "Face-to-Face (Meet in Person)"], bankAccountId: `bank-${account.id}`,
    bankName: "Bank Hapoalim", minimumTrade: "100", maximumTrade: "10000",
    expiresAt: new Date(Date.now() + 48 * 3600_000).toISOString(), sellerDescription: "Synthetic offline listing",
    responseTime: "5 min", status: "active", approvalStatus: "approved", createdAt: now, updatedAt: now,
  }));
  const saved = await fetch(`${baseURL}/api/testing/alpha-exchange-state`, {
    method: "PUT", headers: OFFLINE_HEADERS, body: JSON.stringify(db), signal: AbortSignal.timeout(120_000),
  });
  if (!saved.ok) throw new Error(`Could not seed the isolated fixture (${saved.status}).`);
}
