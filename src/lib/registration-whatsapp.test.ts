import { describe, expect, it } from "vitest";
import { normalizeRegistrationWhatsApp } from "@alpha-traders/contracts";

describe("registration WhatsApp contact format", () => {
  it.each([
    ["0501234567", "+972501234567"],
    [" 050-123-4567 ", "+972501234567"],
    ["972501234567", "+972501234567"],
    ["+972 (50) 123-4567", "+972501234567"],
    ["00972 50 1234567", "+972501234567"],
    ["٠٥٠١٢٣٤٥٦٧", "+972501234567"],
    ["۰۵۰۱۲۳۴۵۶۷", "+972501234567"],
    ["+40 712 345 678", "+40712345678"],
    ["+1 (202) 555-0123", "+12025550123"],
  ])("normalizes %s without claiming verification", (input, expected) => {
    expect(normalizeRegistrationWhatsApp(input)).toBe(expected);
  });

  it.each([undefined, null, 501234567, {}, [], "", "   ", "0000000000", "123", "+123", "++972501234567", "call0501234567", "+1234567890123456", "0".repeat(31)])("rejects malformed or missing contacts: %j", (input) => {
    expect(normalizeRegistrationWhatsApp(input)).toBeNull();
  });
});
