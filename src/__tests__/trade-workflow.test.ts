import { describe, expect, it } from "vitest";
import { getPurchaseRequestStatusTransitionOptions, getTradeStatusDisplayLabel } from "@/lib/trade-workflow";

describe("trade workflow helpers", () => {
  it("lets sellers confirm funds received after buyer marks payment sent", () => {
    expect(getPurchaseRequestStatusTransitionOptions("payment_sent", "seller")).toEqual(["funds_received"]);
  });

  it("lets sellers move to USDT release pending after funds are confirmed", () => {
    expect(getPurchaseRequestStatusTransitionOptions("funds_received", "seller")).toEqual(["usdt_release_pending"]);
  });

  it("uses the bank-transfer wording for the waiting state", () => {
    expect(getTradeStatusDisplayLabel("payment_sent")).toBe("Waiting for bank confirmation");
  });

  // Pre-proof trade cancellation: buyer can cancel a pending (pre-acceptance) trade
  it("lets buyers cancel a pending trade before seller accepts (pre-proof cancellation)", () => {
    expect(getPurchaseRequestStatusTransitionOptions("pending", "buyer")).toContain("cancelled");
  });

  // Buyers should not be able to cancel once payment proof has been submitted
  it("does not allow buyers to cancel after payment has been sent", () => {
    const options = getPurchaseRequestStatusTransitionOptions("payment_sent", "buyer");
    expect(options).not.toContain("cancelled");
  });

  // Buyers can also cancel an accepted trade before uploading proof
  it("does not let buyers cancel once seller acceptance reveals bank details", () => {
    const options = getPurchaseRequestStatusTransitionOptions("accepted", "buyer");
    expect(options).not.toContain("cancelled");
  });
});
