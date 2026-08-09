import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import type { FullConfig } from "@playwright/test";
import { resolveBuyerFixture } from "./support/buyer-fixture";

const scrypt = promisify(scryptCallback);
const TEST_SUPPORT_HEADERS = {
  "content-type": "application/json",
  "x-alpha-test-support": "enabled",
};

const OWNER = {
  id: "e2e-global-owner",
  email: "e2e-global-owner@example.test",
  password: "E2eOwner!Launch2026",
};
const ADMIN = {
  id: "e2e-global-admin",
  email: "e2e-global-admin@example.test",
  password: "E2eAdmin!Launch2026",
};
const SELLER = {
  id: "e2e-global-seller",
  email: "e2e-global-seller@example.test",
  password: "E2eSeller!Launch2026",
};
const LISTING_ID = "e2e-global-seller-listing";

type RuntimeDb = Record<string, unknown>;

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function expiresIn(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 8) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status} for ${url}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed request for ${url}`);
}

async function readRuntimeDb(baseUrl: string) {
  const response = await fetchWithRetry(`${baseUrl}/api/testing/alpha-exchange-state`, {
    method: "GET",
    headers: TEST_SUPPORT_HEADERS,
  });
  return (await response.json()) as RuntimeDb;
}

async function writeRuntimeDb(baseUrl: string, db: RuntimeDb) {
  await fetchWithRetry(`${baseUrl}/api/testing/alpha-exchange-state`, {
    method: "PUT",
    headers: TEST_SUPPORT_HEADERS,
    body: JSON.stringify(db),
  });
}

function ensureArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function upsertUser(db: RuntimeDb, input: {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  role: "owner" | "admin" | "approved_seller";
  roles: string[];
  sellerStatus: "buyer" | "approved_seller";
  verifiedPhone: string;
  onboardingSelection: "buyer" | "seller_applicant";
  isFoundingSeller?: boolean;
}) {
  const users = ensureArray<Record<string, unknown>>(db.users).filter((user) => {
    const email = String(user.email ?? "").toLowerCase();
    return email !== input.email.toLowerCase() && String(user.id ?? "") !== input.id;
  });
  const now = nowIso();
  users.push({
    id: input.id,
    fullName: input.fullName,
    email: input.email.toLowerCase(),
    passwordHash: input.passwordHash,
    role: input.role,
    roles: input.roles,
    sellerStatus: input.sellerStatus,
    whatsappNumber: "+972500000111",
    preferredNetworks: ["TRC20"],
    preferredPaymentMethods: ["Bank Transfer"],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "E2E fixture account",
    country: "Israel",
    city: "",
    coverBannerUrl: "",
    emailVerified: true,
    emailVerifiedAt: now,
    verifiedPhone: input.verifiedPhone,
    phoneVerifiedAt: now,
    buyerVerificationStatus: "verified",
    buyerFirstName: input.fullName.split(" ")[0] ?? "E2E",
    buyerLastName: input.fullName.split(" ").slice(1).join(" ") || "User",
    buyerDisplayName: input.fullName,
    onboardingSelection: input.onboardingSelection,
    onboardingCompletedAt: now,
    onlineStatus: "online",
    availabilityStatus: "available",
    notificationPreferences: { inApp: true, email: false, sms: false },
    isFoundingSeller: input.isFoundingSeller ?? false,
    createdAt: now,
    updatedAt: now,
  });
  db.users = users;
}

function upsertSellerListing(db: RuntimeDb, sellerId: string) {
  const listings = ensureArray<Record<string, unknown>>(db.marketplaceListings).filter((listing) => String(listing.id ?? "") !== LISTING_ID);
  const now = nowIso();
  listings.push({
    id: LISTING_ID,
    sellerId,
    sellerDisplayName: "E2E Global Seller",
    photos: [],
    originalAmount: "1500",
    availableAmount: "1500",
    price: "3.60",
    currency: "ILS",
    network: "TRC20",
    paymentMethod: "Bank Transfer",
    paymentMethods: ["Bank Transfer"],
    bankName: "Bank Hapoalim",
    minimumTrade: "100",
    maximumTrade: "1500",
    expiresAt: expiresIn(72),
    sellerDescription: "Global E2E fixture listing",
    responseTime: "5 min",
    status: "active",
    approvalStatus: "approved",
    createdAt: now,
    updatedAt: now,
  });
  db.marketplaceListings = listings;
}

async function provisionRoleFixtures(baseUrl: string) {
  const [ownerHash, adminHash, sellerHash] = await Promise.all([
    hashPassword(OWNER.password),
    hashPassword(ADMIN.password),
    hashPassword(SELLER.password),
  ]);

  const db = await readRuntimeDb(baseUrl);
  upsertUser(db, {
    id: OWNER.id,
    email: OWNER.email,
    passwordHash: ownerHash,
    fullName: "E2E Global Owner",
    role: "owner",
    roles: ["owner", "admin", "approved_seller", "buyer"],
    sellerStatus: "approved_seller",
    verifiedPhone: "+972500010001",
    onboardingSelection: "seller_applicant",
    isFoundingSeller: true,
  });
  upsertUser(db, {
    id: ADMIN.id,
    email: ADMIN.email,
    passwordHash: adminHash,
    fullName: "E2E Global Admin",
    role: "admin",
    roles: ["admin", "buyer"],
    sellerStatus: "buyer",
    verifiedPhone: "+972500010002",
    onboardingSelection: "buyer",
  });
  upsertUser(db, {
    id: SELLER.id,
    email: SELLER.email,
    passwordHash: sellerHash,
    fullName: "E2E Global Seller",
    role: "approved_seller",
    roles: ["approved_seller", "buyer"],
    sellerStatus: "approved_seller",
    verifiedPhone: "+972500010003",
    onboardingSelection: "seller_applicant",
    isFoundingSeller: true,
  });
  upsertSellerListing(db, SELLER.id);
  await writeRuntimeDb(baseUrl, db);

  process.env.E2E_OWNER_EMAIL = OWNER.email;
  process.env.E2E_OWNER_PASSWORD = OWNER.password;
  process.env.E2E_ADMIN_EMAIL = ADMIN.email;
  process.env.E2E_ADMIN_PASSWORD = ADMIN.password;
  process.env.E2E_SELLER_EMAIL = SELLER.email;
  process.env.E2E_SELLER_PASSWORD = SELLER.password;

  const buyer = await resolveBuyerFixture(
    (process.env.E2E_BUYER_EMAIL ?? "").toLowerCase(),
    process.env.E2E_BUYER_PASSWORD ?? "",
  );
  process.env.E2E_BUYER_EMAIL = buyer.email;
  process.env.E2E_BUYER_PASSWORD = buyer.password;
}

export default async function globalSetup(_config: FullConfig) {
  const requestedPort = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? "3000", 10);
  const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65_535
    ? requestedPort
    : 3000;
  const baseUrl = `http://localhost:${port}`;
  await provisionRoleFixtures(baseUrl);
}
