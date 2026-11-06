function normalizeCodeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0));
}

/** Input formatting only. Verification still requires the server's exact parser. */
export function normalizePhoneVerificationCodeInput(value: string): string {
  return normalizeCodeDigits(value).replace(/\D/g, "").slice(0, 6);
}

/** Normalize supported digit scripts without truncating or stripping invalid input. */
export function normalizePhoneVerificationCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length !== 6) return null;
  const code = normalizeCodeDigits(value);
  return /^\d{6}$/.test(code) ? code : null;
}
