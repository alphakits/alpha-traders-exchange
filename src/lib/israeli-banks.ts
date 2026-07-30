export type IsraeliBankOption = {
  name: string;
  code: string;
  logoUrl?: string;
  description?: string;
};

const ISRAELI_BANK_OPTIONS: IsraeliBankOption[] = [
  {
    name: "Bank Leumi",
    code: "leumi",
    logoUrl: "/images/banks/leumi.svg",
    description: "Fast local transfers with a trusted national bank.",
  },
  {
    name: "Bank Hapoalim",
    code: "hapoalim",
    logoUrl: "/images/banks/hapoalim.svg",
    description: "Widely used for immediate Israeli bank transfers.",
  },
  {
    name: "Mizrahi-Tefahot",
    code: "mizrahi",
    logoUrl: "/images/banks/mizrahi.svg",
    description: "Popular for seamless same-day transfer confirmations.",
  },
  {
    name: "Discount",
    code: "discount",
    logoUrl: "/images/banks/discount.svg",
    description: "Common option for secure Israeli transfers.",
  },
  {
    name: "First International",
    code: "first-international",
    description: "A reliable partner for local transfer coordination.",
  },
  {
    name: "Yahav",
    code: "yahav",
    description: "Well-known for practical local settlement workflows.",
  },
  {
    name: "Mercantile",
    code: "mercantile",
    description: "Trusted for efficient same-day transfer handling.",
  },
  {
    name: "Massad",
    code: "massad",
    description: "A dependable option for local settlement and confirmation.",
  },
  {
    name: "Jerusalem",
    code: "jerusalem",
    description: "A familiar choice for local transfer confirmation.",
  },
  {
    name: "ONE ZERO",
    code: "one-zero",
    description: "A modern local banking option for fast settlement.",
  },
  {
    name: "Bank transfer",
    code: "generic",
    description: "Flexible transfer option for verified local settlement.",
  },
];

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

export function getIsraeliBankOptions() {
  return ISRAELI_BANK_OPTIONS;
}
