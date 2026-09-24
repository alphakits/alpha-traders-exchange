import { describe, expect, it } from "vitest";
import { purchaseBlockDestination, readPurchaseResponse } from "./purchase-response";

describe("purchase submission responses", () => {
  it.each(["<!doctype html><html>Gateway unavailable</html>", "upstream timeout", "", "null", "[]", "{broken"])("handles non-JSON API responses without masking them as network failures: %s", async (body) => {
    await expect(readPurchaseResponse(new Response(body, { status: 502 }))).resolves.toEqual({});
  });
  it("preserves the review blocker and opens the required review directly", async () => {
    const payload = await readPurchaseResponse(new Response(JSON.stringify({
      code: "PENDING_BUYER_FEEDBACK", details: { purchaseRequestId: "purchase-previous" },
    }), { status: 400 }));
    expect(purchaseBlockDestination(String(payload.code), payload.details as Record<string, unknown>))
      .toBe("/trade-room/purchase-previous?action=review-trade#status-banner");
  });
  it.each(["ACTIVE_TRADE_EXISTS", "PURCHASE_REQUEST_ALREADY_SUBMITTED", "AWAITING_BUYER_CONFIRMATION"])("continues an existing trade for %s", (code) => {
    expect(purchaseBlockDestination(code, { purchaseRequestId: "purchase-existing" })).toBe("/trade-room/purchase-existing");
  });
  it("does not navigate to malformed or unrelated destinations", () => {
    expect(purchaseBlockDestination("PENDING_BUYER_FEEDBACK", { purchaseRequestId: "//other.test" })).toBeNull();
    expect(purchaseBlockDestination("UNRELATED", { purchaseRequestId: "purchase-existing" })).toBeNull();
  });
});
