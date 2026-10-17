import { isProductionSecurityRuntime } from "@/lib/runtime-safety";

export const ADULT_CONFIRMATION_METHOD = "self_attestation_v1" as const;
export type AdultEligibility = { method: typeof ADULT_CONFIRMATION_METHOD; confirmedAt: string };

/** A recorded confirmation, not a claim of independently verified identity. */
export function hasAdultConfirmation(user: { ageEligibility?: unknown } | null | undefined) {
  const value = user?.ageEligibility;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.method === ADULT_CONFIRMATION_METHOD && typeof record.confirmedAt === "string"
    && Number.isFinite(Date.parse(record.confirmedAt)) && Date.parse(record.confirmedAt) > 0;
}

export function isAdultConfirmationRequired() {
  return isProductionSecurityRuntime() || process.env.ALPHA_AGE_ELIGIBILITY_TEST_REQUIRED === "1";
}

export function needsAdultConfirmation(user: { ageEligibility?: unknown } | null | undefined) {
  return Boolean(user) && isAdultConfirmationRequired() && !hasAdultConfirmation(user);
}
