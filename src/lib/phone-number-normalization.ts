export function normalizeIsraeliPhone(rawPhone: string) {
  const normalized = String(rawPhone ?? "").replace(/\s+/g, "").replace(/-/g, "");
  if (!normalized) return null;
  if (/^05\d{8}$/.test(normalized)) return `+972${normalized.slice(1)}`;
  if (/^\+9725\d{8}$/.test(normalized)) return normalized;
  if (/^9725\d{8}$/.test(normalized)) return `+${normalized}`;
  return null;
}
