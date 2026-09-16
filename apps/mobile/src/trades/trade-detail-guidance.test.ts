import { describe, expect, it } from "vitest";
import type { MobileTradeDetail } from "@alpha-traders/contracts";
import { mobileTradeGuidanceTarget, shouldGuideMobileTradeStatus } from "./trade-detail-guidance";

function actions(overrides: Partial<MobileTradeDetail["actions"]> = {}): MobileTradeDetail["actions"] {
  return {
    canAccept: false, canDecline: false, canCancel: false, canViewBankDetails: false,
    canMarkPaymentSent: false, canUploadPaymentEvidence: false, canConfirmFunds: false,
    canBeginRelease: false, canMarkUsdtSent: false, canUploadReleaseEvidence: false,
    canConfirmReceived: false, canCompleteFaceToFace: false, canOpenDispute: false,
    canSubmitReview: false, canRespondToReview: false, ...overrides,
  };
}

describe("native Trade Room guidance", () => {
  it("guides buyer and seller to their available lifecycle action", () => {
    expect(mobileTradeGuidanceTarget({ side: "buyer", status: "accepted", actions: actions({ canMarkPaymentSent: true }) })).toBe("actions");
    expect(mobileTradeGuidanceTarget({ side: "seller", status: "payment_sent", actions: actions({ canConfirmFunds: true }) })).toBe("actions");
  });

  it("guides the seller to the newly revealed wallet before the cash-trade send action", () => {
    expect(mobileTradeGuidanceTarget({
      side: "seller",
      status: "funds_received",
      receivingWalletAddress: "TWallet",
      actions: actions({ canMarkUsdtSent: true }),
    })).toBe("wallet");
    expect(mobileTradeGuidanceTarget({ side: "seller", status: "payment_sent", receivingWalletAddress: undefined, actions: actions() })).toBe("hero");
  });

  it("keeps non-cash release guidance on its required lifecycle control", () => {
    expect(mobileTradeGuidanceTarget({
      side: "seller",
      status: "funds_received",
      receivingWalletAddress: "TWallet",
      actions: actions({ canBeginRelease: true }),
    })).toBe("actions");
  });

  it("guides review when feedback becomes required", () => {
    expect(mobileTradeGuidanceTarget({ side: "buyer", status: "review_open", actions: actions({ canSubmitReview: true }) })).toBe("review");
  });

  it("does not move the screen for polling refreshes with the same status", () => {
    expect(shouldGuideMobileTradeStatus("accepted", "payment_sent")).toBe(true);
    expect(shouldGuideMobileTradeStatus("payment_sent", "payment_sent")).toBe(false);
    expect(shouldGuideMobileTradeStatus(null, "pending")).toBe(false);
  });
});
