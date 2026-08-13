import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import type { APIRequestContext } from "@playwright/test";

const scrypt = promisify(scryptCallback);
const TEST_SUPPORT_HEADERS = { "x-alpha-test-support": "enabled" };
const QA_STATE_TIMEOUT_MS = 20_000;
const QA_STATE_REQUEST_ATTEMPTS = 5;

async function readQaState(request: APIRequestContext) {
  let lastError: unknown;
  for (let attempt = 0; attempt < QA_STATE_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await request.get("/api/testing/alpha-exchange-state", {
        headers: TEST_SUPPORT_HEADERS,
      });
      if (response.ok()) {
        return await response.json() as Record<string, unknown>;
      }
      lastError = new Error(`Testing-state read failed (${response.status()}).`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Testing-state read failed.");
}

async function writeQaState(
  request: APIRequestContext,
  db: Record<string, unknown>,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < QA_STATE_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await request.put("/api/testing/alpha-exchange-state", {
        headers: TEST_SUPPORT_HEADERS,
        data: db,
      });
      if (response.ok()) return;
      lastError = new Error(`Testing-state write failed (${response.status()}).`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Testing-state write failed.");
}

export type ProvisionedAccount = { id: string; email: string; password: string };

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

function baseUser(id: string, email: string, passwordHash: string, now: string) {
  return {
    id,
    email,
    passwordHash,
    fullName: id,
    whatsappNumber: "+972500000000",
    preferredNetworks: ["TRC20"],
    preferredPaymentMethods: ["Bank Transfer"],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "QA account",
    country: "Israel",
    city: "",
    coverBannerUrl: "",
    createdAt: now,
    updatedAt: now,
    emailVerified: true,
    emailVerifiedAt: now,
    verifiedPhone: "+972500000000",
    phoneVerifiedAt: now,
    onlineStatus: "online",
    availabilityStatus: "available",
    isProfileHidden: false,
    notificationPreferences: { inApp: true, email: false, sms: false },
  };
}

export type QaWorld = {
  admin: ProvisionedAccount;
  seller: ProvisionedAccount;
  listingId: string;
  stableListingId: string;
  ids: string[];
};

function sellerListing(id: string, sellerId: string, now: string) {
  return {
    id,
    sellerId,
    sellerDisplayName: "QA Seller",
    photos: [],
    originalAmount: "1000",
    availableAmount: "1000",
    price: "3.60",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    paymentMethods: ["Bank Transfer"],
    bankName: "Bank Hapoalim",
    minimumTrade: "100",
    maximumTrade: "1000",
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    sellerDescription: "QA listing.",
    responseTime: "5 min",
    status: "active",
    approvalStatus: "approved",
    createdAt: now,
    updatedAt: now,
  };
}

/** Provision an admin + approved seller (with an active, approved listing) directly
 * through the testing-state API so QA flows can exercise the real server. */
export async function provisionQaWorld(request: APIRequestContext): Promise<QaWorld> {
  const now = new Date().toISOString();
  const db = await readQaState(request);

  const adminId = `qa-admin-${randomUUID()}`;
  const sellerId = `qa-seller-${randomUUID()}`;
  const listingId = `qa-listing-${randomUUID()}`;
  const stableListingId = `qa-listing-stable-${randomUUID()}`;
  const adminEmail = `qa-admin-${randomUUID()}@example.test`;
  const sellerEmail = `qa-seller-${randomUUID()}@example.test`;
  const adminPassword = `Qa!${randomBytes(18).toString("base64url")}`;
  const sellerPassword = `Qa!${randomBytes(18).toString("base64url")}`;

  const admin = { ...baseUser(adminId, adminEmail, await hashPassword(adminPassword), now), role: "admin", roles: ["admin"], sellerStatus: "buyer", fullName: "QA Admin" };
  const seller = { ...baseUser(sellerId, sellerEmail, await hashPassword(sellerPassword), now), role: "approved_seller", roles: ["approved_seller"], sellerStatus: "approved_seller", fullName: "QA Seller", sellerPrestigeRank: "bronze" };

  db.users = [...(Array.isArray(db.users) ? db.users : []), admin, seller];
  db.marketplaceListings = [
    ...(Array.isArray(db.marketplaceListings) ? db.marketplaceListings : []),
    sellerListing(listingId, sellerId, now),
    sellerListing(stableListingId, sellerId, now),
  ];

  await writeQaState(request, db);

  const deadline = Date.now() + QA_STATE_TIMEOUT_MS;
  let authenticated = false;
  let workspaceReady = false;
  while (Date.now() < deadline) {
    if (!authenticated) {
      const loginResponse = await request.post("/api/auth/login", {
        headers: { "x-forwarded-for": "198.51.100.22" },
        data: { email: sellerEmail, password: sellerPassword, rememberMe: false },
      });
      authenticated = loginResponse.ok();
    }
    if (authenticated) {
      const listingsResponse = await request.get("/api/alpha-exchange/my-listings");
      if (listingsResponse.ok()) {
        const payload = await listingsResponse.json() as {
          listings?: Array<{ id?: string }>;
        };
        const observedIds = new Set(
          (payload.listings ?? []).map((listing) => listing.id),
        );
        if (observedIds.has(listingId) && observedIds.has(stableListingId)) {
          workspaceReady = true;
          break;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!workspaceReady) {
    throw new Error("Timed out waiting for the provisioned seller workspace.");
  }

  return {
    admin: { id: adminId, email: adminEmail, password: adminPassword },
    seller: { id: sellerId, email: sellerEmail, password: sellerPassword },
    listingId,
    stableListingId,
    ids: [adminId, sellerId, listingId, stableListingId],
  };
}

/** Remove provisioned QA users/listings and anything referencing them. */
export async function cleanupQaWorld(request: APIRequestContext, world: QaWorld | undefined) {
  if (!world) return;
  const db = await readQaState(request);
  const ids = new Set(world.ids);
  const references = (value: unknown): boolean => {
    if (typeof value === "string") return ids.has(value);
    if (Array.isArray(value)) return value.some(references);
    if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some(references);
    return false;
  };
  for (const [key, value] of Object.entries(db)) {
    if (Array.isArray(value)) db[key] = value.filter((row) => !references(row));
  }
  await writeQaState(request, db);
}
