import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, request, test, type APIRequestContext } from "@playwright/test";
import type { AlphaExchangeDb, UserRole } from "@/types/alpha-exchange";

const scrypt = promisify(scryptCallback);
const TEST_SUPPORT_HEADERS = {
  "content-type": "application/json",
  "x-alpha-test-support": "enabled",
};

const OWNER = {
  email: "qa-owner-listing-notify@example.test",
  password: "OwnerQa!123456",
};
const SELLER = {
  email: "qa-seller-listing-notify@example.test",
  password: "SellerQa!123456",
};
const BUYERS = [
  { email: "qa-buyer-1-listing-notify@example.test", password: "Buyer1Qa!123456" },
  { email: "qa-buyer-2-listing-notify@example.test", password: "Buyer2Qa!123456" },
  { email: "qa-buyer-3-listing-notify@example.test", password: "Buyer3Qa!123456" },
];

const QA_USER_IDS = {
  owner: "user-qa-owner-listing-notify",
  seller: "user-qa-seller-listing-notify",
  buyer1: "user-qa-buyer-1-listing-notify",
  buyer2: "user-qa-buyer-2-listing-notify",
  buyer3: "user-qa-buyer-3-listing-notify",
} as const;

let originalSnapshot: AlphaExchangeDb | null = null;

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function readRuntimeDb(api: APIRequestContext) {
  const response = await api.get("/api/testing/alpha-exchange-state", { headers: TEST_SUPPORT_HEADERS });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as AlphaExchangeDb;
}

async function writeRuntimeDb(api: APIRequestContext, db: AlphaExchangeDb) {
  const response = await api.put("/api/testing/alpha-exchange-state", {
    headers: TEST_SUPPORT_HEADERS,
    data: db,
  });
  expect(response.ok()).toBeTruthy();
}

async function clearMarketplaceEmailHarness(api: APIRequestContext) {
  const response = await api.delete("/api/testing/marketplace-email-attempts", { headers: TEST_SUPPORT_HEADERS });
  expect(response.ok()).toBeTruthy();
}

async function readMarketplaceEmailHarness(api: APIRequestContext) {
  const response = await api.get("/api/testing/marketplace-email-attempts", { headers: TEST_SUPPORT_HEADERS });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as {
    attempts?: Array<{ event: string; to: string; referenceLabel?: string; createdAt: string }>;
  };
  return payload.attempts ?? [];
}

async function loginApi(email: string, password: string) {
  const api = await request.newContext({ baseURL: "http://localhost:3000" });
  const response = await api.post("/api/auth/login", {
    data: { email, password, rememberMe: true },
  });
  expect(response.ok(), `Login failed for ${email}: ${await response.text()}`).toBeTruthy();
  return api;
}

function normalizeRoles(roles?: UserRole[], role?: UserRole) {
  const next = new Set<UserRole>(roles ?? []);
  if (role) next.add(role);
  return [...next];
}

async function upsertQaUser(db: AlphaExchangeDb, input: {
  id: string;
  email: string;
  password: string;
  verifiedPhone: string;
  role: "owner" | "approved_seller" | "buyer";
  roles: Array<"owner" | "admin" | "approved_seller" | "buyer">;
  sellerStatus: "approved_seller" | "buyer";
  fullName: string;
}) {
  const now = new Date().toISOString();
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);

  db.users = db.users.filter((user) => user.email.trim().toLowerCase() !== email && user.id !== input.id);

  const created = {
    id: input.id,
    fullName: input.fullName,
    email,
    passwordHash,
    whatsappNumber: "+972500000111",
    preferredNetworks: [],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    tradingExperience: "",
    workingHours: "",
    country: "Israel",
    city: "",
    coverBannerUrl: "",
    onlineStatus: "online" as const,
    availabilityStatus: "available" as const,
    notificationPreferences: { inApp: true, email: false, sms: false },
    role: input.role,
    roles: normalizeRoles(input.roles, input.role),
    sellerStatus: input.sellerStatus,
    emailVerified: true,
    emailVerifiedAt: now,
    verifiedPhone: input.verifiedPhone,
    phoneVerifiedAt: now,
    buyerVerificationStatus: "verified" as const,
    buyerFirstName: input.fullName.split(" ")[0] ?? "QA",
    buyerLastName: input.fullName.split(" ").slice(1).join(" ") || "User",
    buyerDisplayName: input.fullName,
    onboardingSelection: "buyer" as const,
    onboardingCompletedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  db.users.push(created);
  return created;
}

function countListingPublicationNotifications(db: AlphaExchangeDb, listingId: string) {
  const byUser = new Map<string, number>();
  for (const notification of db.notifications) {
    if (notification.title !== "🟢 New USDT Listing Available") continue;
    if (notification.relatedListingId !== listingId) continue;
    byUser.set(notification.userId, (byUser.get(notification.userId) ?? 0) + 1);
  }
  return byUser;
}

async function waitForListingPublicationEmailAttempts(api: APIRequestContext, listingId: string, expectedCount: number) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const attempts = await readMarketplaceEmailHarness(api);
    const listingAttempts = attempts.filter((attempt) => attempt.event === "new_listing_published" && attempt.referenceLabel === listingId);
    if (listingAttempts.length >= expectedCount) return listingAttempts;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const attempts = await readMarketplaceEmailHarness(api);
  return attempts.filter((attempt) => attempt.event === "new_listing_published" && attempt.referenceLabel === listingId);
}

async function waitForListingPublicationEmailCountsByUser(input: {
  api: APIRequestContext;
  listingId: string;
  qaBuyerIds: string[];
  emailToUserId: Map<string, string>;
  expectedBuyerCount: number;
}) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const attempts = await readMarketplaceEmailHarness(input.api);
    const listingAttempts = attempts.filter((attempt) => attempt.event === "new_listing_published" && attempt.referenceLabel === input.listingId);
    const counts = new Map<string, number>();
    for (const attempt of listingAttempts) {
      const userId = input.emailToUserId.get(attempt.to.trim().toLowerCase());
      if (!userId) continue;
      counts.set(userId, (counts.get(userId) ?? 0) + 1);
    }

    const allBuyersMatch = input.qaBuyerIds.every((buyerId) => (counts.get(buyerId) ?? 0) === input.expectedBuyerCount);
    if (allBuyersMatch) {
      return { listingAttempts, counts };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const attempts = await readMarketplaceEmailHarness(input.api);
  const listingAttempts = attempts.filter((attempt) => attempt.event === "new_listing_published" && attempt.referenceLabel === input.listingId);
  const counts = new Map<string, number>();
  for (const attempt of listingAttempts) {
    const userId = input.emailToUserId.get(attempt.to.trim().toLowerCase());
    if (!userId) continue;
    counts.set(userId, (counts.get(userId) ?? 0) + 1);
  }
  return { listingAttempts, counts };
}

test.describe("listing publication notification regression", () => {
  test.beforeAll(async () => {
    const api = await request.newContext({ baseURL: "http://localhost:3000" });
    const db = await readRuntimeDb(api);
    originalSnapshot = JSON.parse(JSON.stringify(db)) as AlphaExchangeDb;

    await upsertQaUser(db, {
      email: OWNER.email,
      password: OWNER.password,
      id: QA_USER_IDS.owner,
      verifiedPhone: "+972500010001",
      role: "owner",
      roles: ["owner", "admin", "buyer"],
      sellerStatus: "approved_seller",
      fullName: "QA Owner",
    });
    await upsertQaUser(db, {
      email: SELLER.email,
      password: SELLER.password,
      id: QA_USER_IDS.seller,
      verifiedPhone: "+972500010002",
      role: "approved_seller",
      roles: ["approved_seller", "buyer"],
      sellerStatus: "approved_seller",
      fullName: "QA Seller",
    });

    for (let index = 0; index < BUYERS.length; index += 1) {
      await upsertQaUser(db, {
        email: BUYERS[index].email,
        password: BUYERS[index].password,
        id: index === 0 ? QA_USER_IDS.buyer1 : index === 1 ? QA_USER_IDS.buyer2 : QA_USER_IDS.buyer3,
        verifiedPhone: `+97250001001${index + 3}`,
        role: "buyer",
        roles: ["buyer"],
        sellerStatus: "buyer",
        fullName: `QA Buyer ${index + 1}`,
      });
    }

    await writeRuntimeDb(api, db);
    await clearMarketplaceEmailHarness(api);
    await api.dispose();
  });

  test.afterAll(async () => {
    const api = await request.newContext({ baseURL: "http://localhost:3000" });
    if (originalSnapshot) {
      await writeRuntimeDb(api, originalSnapshot);
    }
    await clearMarketplaceEmailHarness(api);
    await api.dispose();
  });

  test("publishing approved listing notifies every eligible buyer exactly once without duplicates after edit", async () => {
    test.setTimeout(120_000);
    const ownerApi = await loginApi(OWNER.email, OWNER.password);
    const sellerApi = await loginApi(SELLER.email, SELLER.password);

    const createResponse = await sellerApi.post("/api/alpha-exchange/listings", {
      data: {
        availableAmount: "550",
        price: "3.20",
        currency: "ILS",
        network: "TRC20",
        paymentMethods: ["Bank Transfer"],
        bankName: "Bank Hapoalim",
        minimumTrade: "50",
        maximumTrade: "550",
        responseTime: "5 min",
        acceptedCommissionPolicy: true,
      },
    });
    expect(createResponse.ok(), await createResponse.text()).toBeTruthy();
    const createdPayload = await createResponse.json() as { listing?: { id: string; sellerId: string } };
    const listingId = String(createdPayload.listing?.id ?? "");
    const creatorUserId = String(createdPayload.listing?.sellerId ?? "");
    expect(listingId).toBeTruthy();

    const approveResponse = await ownerApi.patch(`/api/alpha-exchange/admin/listings/${encodeURIComponent(listingId)}`, {
      data: { action: "approve" },
    });
    expect(approveResponse.ok(), await approveResponse.text()).toBeTruthy();

    const dbAfterApprove = await readRuntimeDb(ownerApi);
    const qaBuyerIds: string[] = [QA_USER_IDS.buyer1, QA_USER_IDS.buyer2, QA_USER_IDS.buyer3];
    expect(qaBuyerIds).toHaveLength(3);
    const qaBuyerIdSet = new Set(qaBuyerIds);

    const notificationCounts = countListingPublicationNotifications(dbAfterApprove, listingId);
    for (const buyerId of qaBuyerIds) {
      expect(notificationCounts.get(buyerId) ?? 0).toBe(1);
    }
    expect(notificationCounts.get(creatorUserId) ?? 0).toBe(0);

    const emailToUserId = new Map<string, string>(
      dbAfterApprove.users.map((user) => [user.email.trim().toLowerCase(), user.id]),
    );
    await waitForListingPublicationEmailAttempts(ownerApi, listingId, qaBuyerIds.length);
    const { counts: emailCountsByUser } = await waitForListingPublicationEmailCountsByUser({
      api: ownerApi,
      listingId,
      qaBuyerIds,
      emailToUserId,
      expectedBuyerCount: 1,
    });

    for (const buyerId of qaBuyerIds) {
      expect(emailCountsByUser.get(buyerId) ?? 0).toBe(1);
    }
    expect(emailCountsByUser.get(creatorUserId) ?? 0).toBe(0);

    const inAppRecipientsAfterApprove = new Set(
      [...notificationCounts.entries()]
        .filter(([, count]) => count === 1)
        .map(([userId]) => userId)
        .filter((userId) => qaBuyerIdSet.has(userId)),
    );
    const emailRecipientsAfterApprove = new Set(
      [...emailCountsByUser.entries()]
        .filter(([, count]) => count === 1)
        .map(([userId]) => userId)
        .filter((userId) => qaBuyerIdSet.has(userId)),
    );
    expect([...inAppRecipientsAfterApprove].sort()).toEqual([...emailRecipientsAfterApprove].sort());

    const editResponse = await sellerApi.patch(`/api/alpha-exchange/listings/${encodeURIComponent(listingId)}`, {
      data: { notes: "QA edit should not re-trigger listing publication broadcasts." },
    });
    expect(editResponse.ok(), await editResponse.text()).toBeTruthy();

    const dbAfterEdit = await readRuntimeDb(ownerApi);
    const notificationCountsAfterEdit = countListingPublicationNotifications(dbAfterEdit, listingId);
    for (const buyerId of qaBuyerIds) {
      expect(notificationCountsAfterEdit.get(buyerId) ?? 0).toBe(1);
    }
    expect(notificationCountsAfterEdit.get(creatorUserId) ?? 0).toBe(0);

    const { counts: emailCountsByUserAfterEdit } = await waitForListingPublicationEmailCountsByUser({
      api: ownerApi,
      listingId,
      qaBuyerIds,
      emailToUserId,
      expectedBuyerCount: 1,
    });

    for (const buyerId of qaBuyerIds) {
      expect(emailCountsByUserAfterEdit.get(buyerId) ?? 0).toBe(1);
    }
    expect(emailCountsByUserAfterEdit.get(creatorUserId) ?? 0).toBe(0);

    const inAppRecipientsAfterEdit = new Set(
      [...notificationCountsAfterEdit.entries()]
        .filter(([, count]) => count === 1)
        .map(([userId]) => userId)
        .filter((userId) => qaBuyerIdSet.has(userId)),
    );
    const emailRecipientsAfterEdit = new Set(
      [...emailCountsByUserAfterEdit.entries()]
        .filter(([, count]) => count === 1)
        .map(([userId]) => userId)
        .filter((userId) => qaBuyerIdSet.has(userId)),
    );
    expect([...inAppRecipientsAfterEdit].sort()).toEqual([...emailRecipientsAfterEdit].sort());

    await ownerApi.dispose();
    await sellerApi.dispose();
  });
});
