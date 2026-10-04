import "server-only";
import { canonicalPhoneNumber } from "@/lib/phone-number-normalization";
import { isAccountPhoneVerificationExempt } from "@/lib/phone-verification-exemptions";

type PhoneAccount = {
  id: string;
  email?: string | null;
  disabled?: boolean;
  whatsappNumber?: string | null;
  verifiedPhone?: string | null;
};

export function assertAccountPhoneAvailable(
  accounts: readonly PhoneAccount[],
  account: PhoneAccount,
  phone: string,
  includeSavedContacts = false,
) {
  const canonical = canonicalPhoneNumber(phone);
  if (!canonical) return;
  // Personal accounts can share a private contact without sharing OTP ownership.
  if (includeSavedContacts && isAccountPhoneVerificationExempt(account)) return;
  if (accounts.some(other => other.id !== account.id && (
    canonicalPhoneNumber(other.verifiedPhone) === canonical
    || (includeSavedContacts && canonicalPhoneNumber(other.whatsappNumber) === canonical)
  ))) {
    throw new Error("This phone number is already linked to another account.");
  }
}
