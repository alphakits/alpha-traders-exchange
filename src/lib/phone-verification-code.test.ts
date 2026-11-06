import { describe, expect, it } from "vitest";
import { normalizePhoneVerificationCode, normalizePhoneVerificationCodeInput } from "./phone-verification-code";

describe("phone verification code digits", () => {
  it.each(["001234", "٠٠١٢٣٤", "۰۰۱۲۳۴", "0٠۱2٣۴"])("preserves six digits and leading zeroes from %s", input => {
    expect(normalizePhoneVerificationCodeInput(input)).toBe("001234");
    expect(normalizePhoneVerificationCode(input)).toBe("001234");
  });

  it("allows input formatting without reusing that permissive behavior for server verification", () => {
    expect(normalizePhoneVerificationCodeInput("٠٠١ ٢٣٤")).toBe("001234");
    expect(normalizePhoneVerificationCodeInput("۰۰۱۲۳۴۵")).toBe("001234");
    expect(normalizePhoneVerificationCode("٠٠١ ٢٣٤")).toBeNull();
    expect(normalizePhoneVerificationCode("۰۰۱۲۳۴۵")).toBeNull();
  });

  it.each([
    "", "12345", "1234567", "001234\n", " 001234", "001234 ", "00 1234",
    "12-3456", "12a456", "٠١٢٣a٥", "۱۲۳۴۵a", "１２３４５６", "¹²³⁴⁵⁶",
    "٠٠١٢٣٤<script>", 123456, null, undefined, ["001234"], { code: "001234" },
  ])("rejects malformed or non-string verification input %j", input => {
    expect(normalizePhoneVerificationCode(input)).toBeNull();
  });
});
