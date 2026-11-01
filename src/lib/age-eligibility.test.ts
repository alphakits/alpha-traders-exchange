import { afterEach, expect, it, vi } from "vitest";
import { hasAdultConfirmation, isAdultConfirmationRequired, needsAdultConfirmation } from "./age-eligibility";

afterEach(() => vi.unstubAllEnvs());

it.each([undefined, null, true, "true", {}, { method: "identity_verified", confirmedAt: "2026-10-01T00:00:00Z" },
  { method: "self_attestation_v1", confirmedAt: "invalid" }])("rejects absent or malformed adult confirmation %j", ageEligibility => {
  expect(hasAdultConfirmation({ ageEligibility })).toBe(false);
});

it("accepts only the persisted confirmation method and timestamp", () => {
  expect(hasAdultConfirmation({ ageEligibility: { method: "self_attestation_v1", confirmedAt: "2026-10-01T00:00:00Z" } })).toBe(true);
});

it("requires confirmation on production even when the local test switch is off", () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VERCEL", "1");
  vi.stubEnv("ALPHA_AGE_ELIGIBILITY_TEST_REQUIRED", "0");
  expect(isAdultConfirmationRequired()).toBe(true);
  expect(needsAdultConfirmation({})).toBe(true);
  expect(needsAdultConfirmation({ ageEligibility: { method: "self_attestation_v1", confirmedAt: "2026-10-01T00:00:00Z" } })).toBe(false);
});
