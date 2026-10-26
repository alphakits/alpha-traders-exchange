import { describe, expect, it } from "vitest";
import { RequestClientError, requestErrorMessage } from "./usdt-request-errors";

describe("Buy Requests client error wording", () => {
  it.each([
    ["DAILY_LIMIT", "طلبين", "two requests"],
    ["REQUEST_CHANGED", "تغيّر", "changed or closed"],
    ["QUOTE_UNAVAILABLE", "مرجع سعر حديث", "fresh price reference"],
    ["TRADE_EXISTS", "مقفل", "locked"],
    ["PRICE_OUTSIDE_BAND", "النطاق المسموح", "allowed range"],
    ["ACTIVE_TRADE_EXISTS", "صفقتك النشطة", "active trade"],
    ["PHONE_VERIFICATION_REQUIRED", "رقم هاتفك", "phone number"],
    ["EMAIL_VERIFICATION_REQUIRED", "بريدك الإلكتروني", "email address"],
    ["AGE_CONFIRMATION_REQUIRED", "18 عامًا", "18 or older"],
  ])("localizes actionable %s without raw server messages", (code, arabic, english) => {
    const error = new RequestClientError(code);
    error.message = "untrusted server diagnostic";
    expect(requestErrorMessage(error, true)).toContain(arabic);
    expect(requestErrorMessage(error, false)).toContain(english);
    expect(requestErrorMessage(error, true)).not.toContain(error.message);
    expect(requestErrorMessage(error, false)).not.toContain(error.message);
  });
  it.each(["UNKNOWN_CODE", "__proto__", "constructor", "toString"])("uses a safe fallback for unrecognized code %s", code => {
    expect(requestErrorMessage(new RequestClientError(code), true)).toBe("تعذر تأكيد النتيجة. حدّث الطلب وراجع حالته قبل المحاولة مجددًا.");
  });
  it("does not expose arbitrary exceptions or untyped server objects", () => {
    for (const value of [new Error("private transport diagnostic"), { code: "DAILY_LIMIT", message: "raw text" }, null]) {
      expect(requestErrorMessage(value, false)).toBe("Could not confirm the result. Refresh the request and check its status before trying again.");
    }
  });
});
