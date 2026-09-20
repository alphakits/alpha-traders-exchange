/** Contact-format validation only; this does not verify ownership or WhatsApp availability. */
export function normalizeRegistrationWhatsApp(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value || value.length > 30) return null;

  const digits = value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
  if (!/^[+\d\s().-]+$/.test(digits)) return null;
  let normalized = digits.replace(/[\s().-]/g, "");
  if (/^05\d{8}$/.test(normalized)) normalized = `+972${normalized.slice(1)}`;
  else if (/^9725\d{8}$/.test(normalized)) normalized = `+${normalized}`;
  else if (normalized.startsWith("00")) normalized = `+${normalized.slice(2)}`;

  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}
