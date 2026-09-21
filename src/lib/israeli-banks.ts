import { ISRAELI_BANK_OPTIONS, type IsraeliBankOption } from "@alpha-traders/contracts";
export type { IsraeliBankOption } from "@alpha-traders/contracts";

export const MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS = 2;

const BANK_NAME_ALIASES: Record<string, string> = {
  leumi: "Bank Leumi",
  hapoalim: "Bank Hapoalim",
  mizrahi: "Mizrahi-Tefahot",
  "mizrahi-tefahot": "Mizrahi-Tefahot",
  "mizrahi-tefahot bank": "Mizrahi-Tefahot",
  "mizrahi tefahot": "Mizrahi-Tefahot",
  "mizrahi tefahot bank": "Mizrahi-Tefahot",
  discount: "Discount",
  "discount bank": "Discount",
  "first international": "First International",
  "first international bank": "First International",
  yahav: "Yahav",
  mercantile: "Mercantile",
  massad: "Massad",
  jerusalem: "Jerusalem",
  "jerusalem bank": "Jerusalem",
  "one zero": "ONE ZERO",
  "one-zero": "ONE ZERO",
  "bank transfer": "Bank transfer",
  "bank transfer israel": "Bank transfer",
  generic: "Bank transfer",
};

export function normalizeIsraeliBankName(rawName?: string | null) {
  const normalized = String(rawName ?? "").trim().toLowerCase();
  if (!normalized) return "Bank transfer";
  const aliasMatch = BANK_NAME_ALIASES[normalized];
  if (aliasMatch) return aliasMatch;
  const exactMatch = ISRAELI_BANK_OPTIONS.find((option) => option.name.toLowerCase() === normalized);
  if (exactMatch) return exactMatch.name;
  return rawName?.trim() || "Bank transfer";
}

export function getIsraeliBankOption(rawName?: string | null): IsraeliBankOption {
  const normalized = normalizeIsraeliBankName(rawName);
  const match = ISRAELI_BANK_OPTIONS.find((option) => option.name.toLowerCase() === normalized.toLowerCase());
  return match ?? ISRAELI_BANK_OPTIONS[ISRAELI_BANK_OPTIONS.length - 1];
}

export function getIsraeliBankDisplayName(rawName: string | null | undefined, locale: "ar" | "en") {
  const raw = String(rawName ?? "").trim();
  const normalized = normalizeIsraeliBankName(raw);
  const option = ISRAELI_BANK_OPTIONS.find((item) => item.name.toLowerCase() === normalized.toLowerCase());
  if (option) return locale === "ar" ? option.nameAr : option.name;
  if (locale === "en") return raw || "Bank transfer";
  return /[\u0600-\u06ff]/u.test(raw) ? raw : "تحويل بنكي";
}

export function getIsraeliBankOptions() {
  return ISRAELI_BANK_OPTIONS;
}

export function parseIsraeliBankSelection(rawValue?: string | null) {
  if (!rawValue) return [] as string[];
  const values = rawValue
    .split(",")
    .map((value) => normalizeIsraeliBankName(value))
    .filter(Boolean);
  return Array.from(new Set(values));
}

export function serializeIsraeliBankSelection(rawValues: string[]) {
  return Array.from(
    new Set(
      rawValues
        .map((value) => normalizeIsraeliBankName(value))
        .filter(Boolean),
    ),
  )
    .slice(0, MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS)
    .join(", ");
}
