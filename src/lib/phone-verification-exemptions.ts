import "server-only";
import { ALPHA_EXCHANGE_OWNER_EMAIL } from "@/lib/alpha-exchange-identity";

// These are the owner's explicitly approved accounts. Roles and client-supplied
// email fields must never grant this exemption; callers use the canonical user.
const exemptEmails = new Set([
  ALPHA_EXCHANGE_OWNER_EMAIL,
  "alphatradersai@gmail.com",
  "claudiahttps11@gmail.com",
]);

export function isMarketplacePhoneVerificationExempt(user: { email?: string | null } | null | undefined) {
  return exemptEmails.has(user?.email?.trim().toLowerCase() ?? "");
}
