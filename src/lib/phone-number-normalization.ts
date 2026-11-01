import { normalizeRegistrationWhatsApp } from "@alpha-traders/contracts";

export function normalizeIsraeliPhone(rawPhone: string) {
  const normalized = normalizeRegistrationWhatsApp(rawPhone);
  return normalized && /^\+9725\d{8}$/.test(normalized) ? normalized : null;
}

/** One comparison key for saved contacts, verification, and database ownership. */
export function canonicalPhoneNumber(rawPhone: string | null | undefined) {
  return normalizeRegistrationWhatsApp(rawPhone);
}
