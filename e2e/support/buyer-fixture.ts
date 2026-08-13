import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { E2E_BASE_URL } from "./base-url";

const TEST_SUPPORT_HEADERS = {
  "content-type": "application/json",
  "x-alpha-test-support": "enabled",
};
const scrypt = promisify(scryptCallback);
const FIXTURE_BUYER_ID = "e2e-buyer-fixture-user";
const FIXTURE_BUYER_EMAIL = "e2e-buyer-fixture@example.test";
const FIXTURE_BUYER_PASSWORD = "E2eBuyer!Launch2026";
const FIXTURE_SELLER_ID = "e2e-buyer-fixture-seller";
const FIXTURE_LISTING_ID = "e2e-buyer-fixture-listing";

export type BuyerFixture = {
  email: string;
  password: string;
  userId?: string;
  listingId: string;
  cleanupIds: string[];
};

function hasPrivilegedRole(user: Record<string, unknown>) {
  const role = typeof user.role === "string" ? user.role : "";
  if (role === "admin" || role === "owner") return true;
  const roles = Array.isArray(user.roles) ? user.roles.filter((entry): entry is string => typeof entry === "string") : [];
  return roles.includes("admin") || roles.includes("owner");
}

function isBuyerAccount(user: Record<string, unknown>) {
  if (hasPrivilegedRole(user)) return false;
  const role = typeof user.role === "string" ? user.role : "";
  const sellerStatus = typeof user.sellerStatus === "string" ? user.sellerStatus : "";
  const roles = Array.isArray(user.roles) ? user.roles.filter((entry): entry is string => typeof entry === "string") : [];
  return role === "buyer" || sellerStatus === "buyer" || roles.includes("buyer");
}

async function canLogin(email: string, password: string) {
  if (!email || !password) return false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${E2E_BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.10" },
      body: JSON.stringify({ email, password, rememberMe: false }),
    });
    if (response.ok) return true;
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function readRuntimeDb() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${E2E_BASE_URL}/api/testing/alpha-exchange-state`, {
      headers: TEST_SUPPORT_HEADERS,
    });
    if (response.ok) {
      return (await response.json()) as Record<string, unknown>;
    }
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Unable to read E2E runtime state after retries.");
}

async function writeRuntimeDb(db: Record<string, unknown>) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${E2E_BASE_URL}/api/testing/alpha-exchange-state`, {
      method: "PUT",
      headers: TEST_SUPPORT_HEADERS,
      body: JSON.stringify(db),
    });
    if (response.ok) return;
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Unable to write E2E runtime state after retries.");
}

async function waitForEligibleListing(listingId: string) {
  const deadline = Date.now() + 30_000;
  let consecutiveObservations = 0;
  while (Date.now() < deadline) {
    const response = await fetch(`${E2E_BASE_URL}/api/alpha-exchange/listings`, {
      cache: "no-store",
    });
    if (response.ok) {
      const payload = await response.json() as {
        listings?: Array<{ id?: string }>;
      };
      if ((payload.listings ?? []).some((listing) => listing.id === listingId)) {
        consecutiveObservations += 1;
        if (consecutiveObservations >= 6) return;
      } else {
        consecutiveObservations = 0;
      }
    } else {
      consecutiveObservations = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for the eligible E2E listing to remain observable.");
}

async function hasEligibleListing(listingId: string) {
  const response = await fetch(`${E2E_BASE_URL}/api/alpha-exchange/listings`, {
    cache: "no-store",
  });
  if (!response.ok) return false;
  const payload = await response.json() as {
    listings?: Array<{ id?: string }>;
  };
  return (payload.listings ?? []).some((listing) => listing.id === listingId);
}

function seedEligibleListing(db: Record<string, unknown>, now: string) {
  const sellerId = FIXTURE_SELLER_ID;
  const listingId = FIXTURE_LISTING_ID;
  const users = Array.isArray(db.users) ? db.users.filter((entry) => {
    if (!entry || typeof entry !== "object") return true;
    const record = entry as Record<string, unknown>;
    const id = String(record.id ?? "");
    const email = String(record.email ?? "").toLowerCase();
    return id !== sellerId && !id.startsWith("seller-e2e-buyer-fixture-") && email !== `${sellerId}@example.test`;
  }) : [];
  db.users = [
    ...users,
    {
      id: sellerId,
      fullName: "E2E Marketplace Seller",
      email: `${sellerId}@example.test`,
      passwordHash: "unused",
      role: "approved_seller",
      roles: ["approved_seller"],
      sellerStatus: "approved_seller",
      whatsappNumber: "+972500000098",
      preferredNetworks: ["TRC20"],
      preferredPaymentMethods: ["Bank Transfer"],
      profilePhotoUrl: "",
      languages: ["English"],
      bio: "E2E marketplace fixture",
      country: "Israel",
      createdAt: now,
      updatedAt: now,
      emailVerified: true,
      emailVerifiedAt: now,
      verifiedPhone: "+972500000098",
      phoneVerifiedAt: now,
      onlineStatus: "online",
      availabilityStatus: "available",
      isProfileHidden: false,
    },
  ];
  const listings = Array.isArray(db.marketplaceListings)
    ? db.marketplaceListings.filter((entry) => {
      if (!entry || typeof entry !== "object") return true;
      const record = entry as Record<string, unknown>;
      const id = String(record.id ?? "");
      const recordSellerId = String(record.sellerId ?? "");
      return id !== listingId && !id.startsWith("listing-e2e-buyer-fixture-") && recordSellerId !== sellerId;
    })
    : [];
  db.marketplaceListings = [
    ...listings,
    {
      id: listingId,
      sellerId,
      sellerDisplayName: "E2E Marketplace Seller",
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
      sellerDescription: "E2E listing for buyer performance validation.",
      responseTime: "5 min",
      status: "active",
      approvalStatus: "approved",
      createdAt: now,
      updatedAt: now,
    },
  ];
  return { cleanupIds: [sellerId, listingId], listingId };
}

export async function resolveBuyerFixture(configuredEmail: string, configuredPassword: string): Promise<BuyerFixture> {
  const normalizedEmail = configuredEmail.trim().toLowerCase();
  if (await canLogin(normalizedEmail, configuredPassword)) {
    const db = await readRuntimeDb();
    const users = Array.isArray(db.users) ? db.users : [];
    const configuredUser = users.find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const candidateEmail = (entry as Record<string, unknown>).email;
      return typeof candidateEmail === "string" && candidateEmail.toLowerCase() === normalizedEmail;
    });

    if (configuredUser && typeof configuredUser === "object" && isBuyerAccount(configuredUser as Record<string, unknown>)) {
      const seededListing = seedEligibleListing(db, new Date().toISOString());
      await writeRuntimeDb(db);
      await waitForEligibleListing(seededListing.listingId);
      return {
        email: normalizedEmail,
        password: configuredPassword,
        listingId: seededListing.listingId,
        cleanupIds: seededListing.cleanupIds,
      };
    }
  }

  const userId = FIXTURE_BUYER_ID;
  const email = FIXTURE_BUYER_EMAIL;
  const password = FIXTURE_BUYER_PASSWORD;
  const passwordHash = await hashPassword(password);
  let seededListing: { cleanupIds: string[]; listingId: string } | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const db = await readRuntimeDb();
    const now = new Date().toISOString();
    const users = Array.isArray(db.users) ? db.users.filter((entry) => {
      if (!entry || typeof entry !== "object") return true;
      const record = entry as Record<string, unknown>;
      const id = String(record.id ?? "");
      const recordEmail = String(record.email ?? "").toLowerCase();
      return id !== userId && !id.startsWith("user-e2e-") && recordEmail !== email && !recordEmail.startsWith("e2e-buyer-");
    }) : [];
    db.users = [
      ...users,
      {
        id: userId,
        fullName: "E2E Buyer",
        email,
        passwordHash,
        role: "buyer",
        roles: ["buyer"],
        sellerStatus: "buyer",
        whatsappNumber: "+972500000099",
        preferredNetworks: [],
        profilePhotoUrl: "",
        languages: ["English"],
        bio: "",
        createdAt: now,
        updatedAt: now,
        emailVerified: true,
        emailVerifiedAt: now,
        verifiedPhone: "+972500000099",
        phoneVerifiedAt: now,
        buyerVerificationStatus: "verified",
        buyerFirstName: "E2E",
        buyerLastName: "Buyer",
        buyerDisplayName: "E2E Buyer",
        onboardingSelection: "buyer",
        onboardingCompletedAt: now,
        onlineStatus: "online",
        availabilityStatus: "available",
        isFoundingSeller: false,
      },
    ];
    seededListing = seedEligibleListing(db, now);
    await writeRuntimeDb(db);
    if (await canLogin(email, password)) {
      await waitForEligibleListing(seededListing.listingId);
      break;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!seededListing || !(await canLogin(email, password))) {
    throw new Error("Provisioned E2E buyer could not authenticate.");
  }
  const cleanupIds = [userId, email, ...seededListing.cleanupIds];
  return {
    email,
    password,
    userId,
    listingId: seededListing.listingId,
    cleanupIds,
  };
}

export async function ensureBuyerFixtureListing(fixture: BuyerFixture) {
  if (await hasEligibleListing(fixture.listingId)) return;

  const db = await readRuntimeDb();
  const seededListing = seedEligibleListing(db, new Date().toISOString());
  await writeRuntimeDb(db);
  await waitForEligibleListing(seededListing.listingId);
  fixture.listingId = seededListing.listingId;
  fixture.cleanupIds.push(...seededListing.cleanupIds);
}

function containsIdentifier(value: unknown, identifiers: Set<string>): boolean {
  if (typeof value === "string") return identifiers.has(value);
  if (Array.isArray(value)) return value.some((entry) => containsIdentifier(entry, identifiers));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) => containsIdentifier(entry, identifiers));
  }
  return false;
}

export async function cleanupBuyerFixture(fixture: BuyerFixture | undefined) {
  if (!fixture) return;

  const db = await readRuntimeDb();
  const identifiers = new Set(fixture.cleanupIds.filter((value) => value !== FIXTURE_BUYER_ID && value !== FIXTURE_BUYER_EMAIL));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const value of Object.values(db)) {
      if (!Array.isArray(value)) continue;
      for (const entry of value) {
        if (!entry || typeof entry !== "object" || !containsIdentifier(entry, identifiers)) continue;
        const id = (entry as Record<string, unknown>).id;
        if (typeof id === "string" && !identifiers.has(id)) {
          identifiers.add(id);
          expanded = true;
        }
      }
    }
  }

  for (const [key, value] of Object.entries(db)) {
    if (!Array.isArray(value)) continue;
    db[key] = value.filter((entry) => !containsIdentifier(entry, identifiers));
  }
  await writeRuntimeDb(db);
}
