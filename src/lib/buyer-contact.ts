import { normalizeRegistrationWhatsApp } from "@alpha-traders/contracts";

type ContactAccount = { role?: string; roles?: readonly string[]; whatsappNumber?: string; onboardingSelection?: string };

export function requiresBuyerContact(user: ContactAccount | null | undefined) {
  if (!user) return false;
  const roles = [user.role, ...(user.roles ?? [])];
  if (roles.includes("owner")) return false;
  return roles.includes("buyer") || roles.includes("approved_seller") || user.onboardingSelection === "buyer";
}

export function needsBuyerContact(user: ContactAccount | null | undefined) {
  return requiresBuyerContact(user) && !normalizeRegistrationWhatsApp(user?.whatsappNumber);
}

export class PrivateContactError extends Error {
  readonly code = "PRIVATE_CONTACT_REQUIRED";
  constructor() {
    super("Add a valid private phone or WhatsApp number in your profile so the owner can reach you when needed.");
    this.name = "PrivateContactError";
  }
}

export function normalizePrivateContact(value: string, required: boolean) {
  if (!value.trim() && !required) return "";
  const normalized = normalizeRegistrationWhatsApp(value);
  if (!normalized) throw new PrivateContactError();
  return normalized;
}
