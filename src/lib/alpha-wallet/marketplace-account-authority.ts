import "server-only";
import { hasAdultConfirmation } from "@/lib/age-eligibility";
import { isAccountPhoneVerificationExempt } from "@/lib/phone-verification-exemptions";
import { hasSellerOperationalAccess } from "@/lib/seller-approval-verification";
import { hasVerifiedPhone } from "@/lib/verification-bypass";
import type { SellerStatus, UserRole } from "@/types/alpha-exchange";
import { WalletAccessError } from "./access";

/** Canonical columns read by the fixed transaction-owned authentication readers. */
export type DevelopmentMarketplaceAccountRow = {
  account_id: string;
  account_email: string;
  account_role: string;
  account_seller_status: string;
  account_payload: unknown;
};
export type DevelopmentMarketplaceAccountAuthority = Readonly<{ userId: string; canBuy: boolean; canSell: boolean; isOwner: boolean }>;

const ROLES = new Set(["guest", "student", "buyer", "pending_seller_approval", "approved_seller", "admin", "owner"]);
const SELLER_STATUSES = new Set(["buyer", "pending_seller_approval", "approved_seller", "rejected", "suspended"]);
const USER_ID = /^[A-Za-z0-9_-]{1,80}$/;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function invalidRecord(): never { throw new WalletAccessError("WALLET_AUTH_RECORD_INVALID", 503); }

/** Identity consistency is checked before session expiry, preserving the web contract. */
export function validateDevelopmentMarketplaceAccountRecord(row: DevelopmentMarketplaceAccountRow, userId: string) {
  const user = row.account_payload;
  if (!record(user) || typeof userId !== "string" || !USER_ID.test(userId)
    || row.account_id !== userId || user.id !== userId
    || typeof row.account_email !== "string" || !row.account_email || user.email !== row.account_email
    || typeof row.account_role !== "string" || !ROLES.has(row.account_role) || user.role !== row.account_role
    || typeof row.account_seller_status !== "string" || !SELLER_STATUSES.has(row.account_seller_status)
    || user.sellerStatus !== row.account_seller_status) return invalidRecord();
  return user;
}

/** Shared policy, never an injectable session resolver or a caller-supplied actor. */
export function developmentMarketplaceAccountAuthority(
  row: DevelopmentMarketplaceAccountRow, userId: string,
): DevelopmentMarketplaceAccountAuthority {
  const user = validateDevelopmentMarketplaceAccountRecord(row, userId);
  if (user.disabled !== undefined && user.disabled !== false) throw new WalletAccessError("WALLET_ACCOUNT_DISABLED");
  if (user.emailVerified !== true) throw new WalletAccessError("WALLET_EMAIL_VERIFICATION_REQUIRED");
  const phone = {
    id: row.account_id, email: row.account_email, disabled: false,
    verifiedPhone: typeof user.verifiedPhone === "string" ? user.verifiedPhone : undefined,
    phoneVerifiedAt: typeof user.phoneVerifiedAt === "string" ? user.phoneVerifiedAt : undefined,
  };
  if (!hasVerifiedPhone(phone) && !isAccountPhoneVerificationExempt(phone)) {
    throw new WalletAccessError("WALLET_PHONE_VERIFICATION_REQUIRED");
  }
  if (!hasAdultConfirmation(user)) throw new WalletAccessError("WALLET_ADULT_CONFIRMATION_REQUIRED");
  if (user.roles !== undefined && (!Array.isArray(user.roles)
    || user.roles.some(role => typeof role !== "string" || !ROLES.has(role)))) return invalidRecord();
  const roles = new Set([row.account_role, ...((user.roles ?? []) as string[])]);
  return Object.freeze({ userId: row.account_id, canBuy: roles.has("buyer") || roles.has("admin") || roles.has("owner"),
    // Match the canonical selling policy. An old approved-seller role label
    // does not override the current suspended/rejected seller status. The
    // coordinator must separately bind this capability to request.sellerId.
    canSell: hasSellerOperationalAccess({ role: row.account_role as UserRole, roles: [...roles] as UserRole[],
      sellerStatus: row.account_seller_status as SellerStatus }),
    isOwner: roles.has("owner") });
}
