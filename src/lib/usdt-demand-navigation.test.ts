import { describe, expect, it } from "vitest";
import { buyRequestsDestination } from "@/lib/usdt-demand-navigation";

const buyer = {
  id: "buyer",
  role: "buyer",
  roles: ["buyer"],
  sellerStatus: "buyer",
  emailVerified: true,
  isPhotoVerified: false,
  adultConfirmed: true,
} as unknown as NonNullable<Parameters<typeof buyRequestsDestination>[0]>;

describe("Buy Requests navigation eligibility", () => {
  it("allows an email-verified adult buyer with a contact-only phone number", () => {
    expect(buyRequestsDestination(buyer, true)).toBe("/usdt-exchange/requests?scope=mine");
  });

  it("continues to require email and adult confirmation", () => {
    expect(buyRequestsDestination({ ...buyer, emailVerified: false }, true)).toBeNull();
    expect(buyRequestsDestination({ ...buyer, adultConfirmed: false }, true)).toBeNull();
  });

  it("does not expose Buy Requests when the feature is disabled", () => {
    expect(buyRequestsDestination(buyer, false)).toBeNull();
  });
});
