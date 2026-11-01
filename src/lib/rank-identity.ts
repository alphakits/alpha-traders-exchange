/** Presentation only: rank eligibility and earned progress live in the prestige modules. */
export const RANK_VISUAL_KEYS = ["bronze", "silver", "gold", "platinum", "diamond", "elite", "legendary"] as const;
export type RankVisualKey = (typeof RANK_VISUAL_KEYS)[number];

const RANK_LABELS: Record<RankVisualKey, { en: string; ar: string }> = {
  bronze: { en: "Bronze", ar: "برونزي" },
  silver: { en: "Silver", ar: "فضي" },
  gold: { en: "Gold", ar: "ذهبي" },
  platinum: { en: "Platinum", ar: "بلاتيني" },
  diamond: { en: "Diamond", ar: "ماسي" },
  elite: { en: "Alpha Elite", ar: "نخبة Alpha" },
  legendary: { en: "Legendary", ar: "أسطوري" },
};

export function rankVisualKey(value?: string | null): RankVisualKey {
  const key = value?.trim().toLowerCase();
  return RANK_VISUAL_KEYS.find((rank) => rank === key) ?? "bronze";
}

/** Existing seller surfaces use the legendary finish for the canonical Elite tier. */
export function rankSurfaceTone(value?: string | null) {
  const rank = rankVisualKey(value);
  return rank === "elite" ? "legendary" : rank;
}

export function rankIdentityLabel(value: string | null | undefined, locale: "en" | "ar" = "en", audience?: "buyer" | "seller") {
  const label = RANK_LABELS[rankVisualKey(value)][locale];
  if (!audience) return label;
  if (locale === "ar") return `${audience === "buyer" ? "مشتري" : "بائع"} ${label}`;
  return `${label} ${audience === "buyer" ? "Buyer" : "Seller"}`;
}
