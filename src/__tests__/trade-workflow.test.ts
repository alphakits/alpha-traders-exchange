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
});
