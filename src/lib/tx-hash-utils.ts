/**
 * Normalizes a raw transaction hash pasted by the user.
 *
 * Strips all Unicode whitespace and invisible characters (zero-width spaces,
 * narrow no-break spaces, BOM, soft-hyphens, etc.) that survive
 * String.prototype.trim() but break hex validation. Also normalizes the
 * `0X` prefix to lowercase `0x`.
 *
 * Safe to use in both server and client code — no Node.js dependencies.
 */
export function normalizeTransactionHash(raw: string): string {
  // \p{Z} = Unicode separator chars (SPACE, NBSP, NNBSP, thin space, etc.)
  // \p{C} = Unicode control/format chars (zero-width spaces, BOM, soft-hyphen, etc.)
  const stripped = raw.replace(/[\p{Z}\p{C}]/gu, "");
  // Normalize uppercase 0X prefix to 0x (some explorers copy it this way)
  return stripped.startsWith("0X") ? "0x" + stripped.slice(2) : stripped;
}
