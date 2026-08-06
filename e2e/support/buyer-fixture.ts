import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const BASE_URL = "http://localhost:3000";
const TEST_SUPPORT_HEADERS = {
  "content-type": "application/json",
  "x-alpha-test-support": "enabled",
};
const scrypt = promisify(scryptCallback);

export type BuyerFixture = {
  email: string;
  password: string;
  userId?: string;
};

async function canLogin(email: string, password: string) {
  if (!email || !password) return false;
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, rememberMe: false }),
  });
  return response.ok;
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function readRuntimeDb() {
  const response = await fetch(`${BASE_URL}/api/testing/alpha-exchange-state`, {
    headers: TEST_SUPPORT_HEADERS,
  });
  if (!response.ok) {
    throw new Error(`Unable to read E2E runtime state (${response.status}).`);
  }
  return (await response.json()) as Record<string, unknown>;
}

async function writeRuntimeDb(db: Record<string, unknown>) {
  const response = await fetch(`${BASE_URL}/api/testing/alpha-exchange-state`, {
    method: "PUT",
    headers: TEST_SUPPORT_HEADERS,
    body: JSON.stringify(db),
  });
  if (!response.ok) {
    throw new Error(`Unable to write E2E runtime state (${response.status}).`);
  }
}

export async function resolveBuyerFixture(configuredEmail: string, configuredPassword: string): Promise<BuyerFixture> {
  const normalizedEmail = configuredEmail.trim().toLowerCase();
  if (await canLogin(normalizedEmail, configuredPassword)) {
    return { email: normalizedEmail, password: configuredPassword };
  }

  const db = await readRuntimeDb();
  const now = new Date().toISOString();
  const userId = `user-e2e-${randomUUID()}`;
  const email = `e2e-buyer-${randomUUID()}@example.test`;
  const password = `E2e!${randomBytes(24).toString("base64url")}`;
  const users = Array.isArray(db.users) ? db.users : [];
  db.users = [
    ...users,
    {
      id: userId,
      fullName: "E2E Buyer",
      email,
      passwordHash: await hashPassword(password),
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
  await writeRuntimeDb(db);

  if (!(await canLogin(email, password))) {
    throw new Error("Provisioned E2E buyer could not authenticate.");
  }
  return { email, password, userId };
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
  if (!fixture?.userId) return;

  const db = await readRuntimeDb();
  const identifiers = new Set([fixture.userId, fixture.email]);
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
