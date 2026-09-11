import { describe, expect, it } from "vitest";
import { sellerApplicationErrorMessage } from "./seller-application-errors";

describe("sellerApplicationErrorMessage", () => {
  it("localizes structured API validation failures", () => {
    expect(sellerApplicationErrorMessage({ code: "WHATSAPP_REQUIRED" }, true))
      .toBe("أدخل رقم واتساب قبل تقديم طلب البائع.");
    expect(sellerApplicationErrorMessage({ code: "SELLING_METHOD_REQUIRED" }, false))
      .toBe("Select at least one selling method.");
  });

  it("localizes legacy error strings while preserving support details", () => {
    expect(sellerApplicationErrorMessage({
      error: "WhatsApp number is required.",
      requestId: "request-123",
    }, true)).toBe("أدخل رقم واتساب قبل تقديم طلب البائع. (request-123)");
  });
});
