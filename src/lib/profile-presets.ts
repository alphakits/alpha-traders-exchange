import type { SellerLevel } from "@/types/alpha-exchange";

export const PROFILE_AVATARS = ["orbit", "nova", "aura", "pulse", "zenith", "prism", "luna", "atlas"].map((id) => ({
  id, url: `/images/profile-presets/avatars/${id}.svg`,
}));

export const PROFILE_BANNERS: Array<{ id: string; rank: SellerLevel; url: string }> = [
  { id: "midnight", rank: "bronze", url: "/images/profile-presets/banners/midnight.svg" },
  { id: "network", rank: "bronze", url: "/images/profile-presets/banners/network.svg" },
  { id: "silver", rank: "silver", url: "/images/profile-presets/banners/silver.svg" },
  { id: "gold", rank: "gold", url: "/images/profile-presets/banners/gold.svg" },
  { id: "diamond", rank: "diamond", url: "/images/profile-presets/banners/diamond.svg" },
  { id: "elite", rank: "elite", url: "/images/profile-presets/banners/elite.svg" },
];

export const PROFILE_RANKS: SellerLevel[] = ["bronze", "silver", "gold", "diamond", "elite"];
export function canUseProfileBanner(url: string, rank: SellerLevel, isAdmin = false) {
  const banner = PROFILE_BANNERS.find((item) => item.url === url);
  return Boolean(banner && (isAdmin || PROFILE_RANKS.indexOf(rank) >= PROFILE_RANKS.indexOf(banner.rank)));
}

/** Stable fallback for existing accounts; new accounts persist a random preset. */
export function defaultProfileAvatar(userId: string) {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PROFILE_AVATARS[hash % PROFILE_AVATARS.length].url;
}

export function profileRankLabel(rank: string, isAr: boolean) {
  const labels: Record<string, [string, string]> = {
    bronze: ["Bronze", "برونزي"], silver: ["Silver", "فضي"], gold: ["Gold", "ذهبي"],
    diamond: ["Diamond", "ألماسي"], elite: ["Elite", "النخبة"],
  };
  return labels[rank]?.[isAr ? 1 : 0] ?? rank;
}
