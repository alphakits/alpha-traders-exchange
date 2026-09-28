export function normalizePublicProfileUsername(value: string | null | undefined) {
  const base = String(value ?? "seller")
    .trim()
    .toLowerCase()
    .split("@")[0];
  const normalized = base
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return normalized || "seller";
}
