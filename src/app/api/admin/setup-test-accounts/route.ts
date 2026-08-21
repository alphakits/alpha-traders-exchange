/**
 * POST /api/admin/setup-test-accounts
 *
 * One-time admin operation: configure the 3 production test accounts.
 * Protected by x-setup-secret header (or localhost-only without the header).
 *
 * Accounts configured:
 *   Owner:  jozenmark834@yahoo.com
 *   Seller: marksally11@yahoo.com
 *   Buyer:  jozenmark@gmail.com
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAlphaExchangeRepository } from "@/lib/alpha-exchange-repository";
import { invalidateAlphaExchangeStoreCache } from "@/lib/alpha-exchange-store";
import type { AlphaExchangeUser, SellerStatus, UserRole } from "@/types/alpha-exchange";

const SETUP_SECRET = process.env.ALPHA_SETUP_SECRET;

function productionUnavailable() {
  return process.env.NODE_ENV === "production"
    ? NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } })
    : null;
}

function isAuthorized(request: NextRequest): boolean {
  const providedSecret = request.headers.get("x-setup-secret");

  if (process.env.NODE_ENV === "production") {
    // The Host header is client-controlled and cannot be trusted in production,
    // and this endpoint mutates privileged accounts. Require an explicitly
    // configured secret that matches the presented header — no default, no host bypass.
    return Boolean(SETUP_SECRET) && providedSecret === SETUP_SECRET;
  }

  // Local/dev convenience: allow localhost, or the configured/default secret.
  const host = request.headers.get("host") ?? "";
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const devSecret = SETUP_SECRET ?? "alpha-setup-localhost";
  return isLocalhost || providedSecret === devSecret;
}

type AccountConfig = {
  email: string;
  fullName: string;
  role: UserRole;
  roles: UserRole[];
  sellerStatus: SellerStatus;
  buyerFirstName: string;
  buyerLastName: string;
  buyerDisplayName: string;
  isFoundingSeller?: boolean;
  verifiedPhoneSuffix: string;
};

const TARGET_ACCOUNTS: Record<string, AccountConfig> = {
  owner: {
    email: "jozenmark834@yahoo.com",
    fullName: "Mark Jozen",
    role: "owner",
    roles: ["owner", "admin", "approved_seller", "buyer"],
    sellerStatus: "approved_seller",
    buyerFirstName: "Mark",
    buyerLastName: "Jozen",
    buyerDisplayName: "Mark Jozen",
    verifiedPhoneSuffix: "001",
  },
  seller: {
    email: "marksally11@yahoo.com",
    fullName: "Mark Sally",
    role: "approved_seller",
    roles: ["approved_seller", "buyer"],
    sellerStatus: "approved_seller",
    buyerFirstName: "Mark",
    buyerLastName: "Sally",
    buyerDisplayName: "Mark Sally",
    isFoundingSeller: true,
    verifiedPhoneSuffix: "002",
  },
  buyer: {
    email: "jozenmark@gmail.com",
    fullName: "Jozen Mark",
    role: "buyer",
    roles: ["buyer"],
    sellerStatus: "buyer",
    buyerFirstName: "Jozen",
    buyerLastName: "Mark",
    buyerDisplayName: "Jozen Mark",
    verifiedPhoneSuffix: "003",
  },
};

export async function POST(request: NextRequest) {
  const unavailable = productionUnavailable();
  if (unavailable) return unavailable;
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const repository = await getAlphaExchangeRepository();
  const db = await repository.loadSnapshot();
  const now = new Date().toISOString();
  const results: Record<string, string> = {};

  for (const [accountType, config] of Object.entries(TARGET_ACCOUNTS)) {
    const normalizedEmail = config.email.trim().toLowerCase();
    const existingIndex = db.users.findIndex(
      (u) => u.email.trim().toLowerCase() === normalizedEmail
    );

    const configuredFields: Partial<AlphaExchangeUser> = {
      role: config.role,
      roles: [...config.roles],
      sellerStatus: config.sellerStatus,
      emailVerified: true,
      emailVerifiedAt: now,
      verifiedPhone: `+9725000${config.verifiedPhoneSuffix}`,
      phoneVerifiedAt: now,
      buyerVerificationStatus: "verified",
      buyerFirstName: config.buyerFirstName,
      buyerLastName: config.buyerLastName,
      buyerDisplayName: config.buyerDisplayName,
      onboardingCompletedAt: now,
      onlineStatus: "online",
      availabilityStatus: "available",
      isFoundingSeller: config.isFoundingSeller ?? false,
      onboardingSelection: config.role === "buyer" ? "buyer" : "seller_applicant",
    };

    if (existingIndex !== -1) {
      db.users[existingIndex] = {
        ...db.users[existingIndex],
        ...configuredFields,
        updatedAt: now,
      };
      results[accountType] = `updated — ${normalizedEmail}`;
    } else {
      const newUser: AlphaExchangeUser = {
        id: `user-${randomUUID()}`,
        fullName: config.fullName,
        email: normalizedEmail,
        passwordHash: "",
        whatsappNumber: "+972500000000",
        preferredNetworks: [],
        profilePhotoUrl: "",
        languages: [],
        bio: "",
        createdAt: now,
        updatedAt: now,
        ...configuredFields,
      } as AlphaExchangeUser;
      db.users.push(newUser);
      results[accountType] = `created — ${normalizedEmail}`;
    }
  }

  await repository.saveSnapshot(db);
  invalidateAlphaExchangeStoreCache();

  return NextResponse.json(
    { ok: true, timestamp: now, results },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET(request: NextRequest) {
  const unavailable = productionUnavailable();
  if (unavailable) return unavailable;
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const repository = await getAlphaExchangeRepository();
  const db = await repository.loadSnapshot();
  const targetEmails = Object.values(TARGET_ACCOUNTS).map((a) => a.email.toLowerCase());

  const accounts = db.users
    .filter((u) => targetEmails.includes(u.email.trim().toLowerCase()))
    .map((u) => ({
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      roles: u.roles,
      sellerStatus: u.sellerStatus,
      emailVerified: u.emailVerified,
      hasVerifiedPhone: Boolean(u.verifiedPhone && u.phoneVerifiedAt),
      buyerVerificationStatus: u.buyerVerificationStatus,
      onboardingCompletedAt: u.onboardingCompletedAt,
    }));

  return NextResponse.json(
    { accounts, found: accounts.length, expected: targetEmails.length },
    { headers: { "Cache-Control": "no-store" } }
  );
}
