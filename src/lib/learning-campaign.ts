/** Public, non-personal campaign codes. Never accept arbitrary URL values. */
export const LEARNING_CAMPAIGN_LINKS = [
  { id: "ig_bio", source: "instagram", medium: "organic_social", campaign: "alpha_ar_il_launch_01", content: "bio", path: "/start" },
  { id: "ig_r01", source: "instagram", medium: "organic_social", campaign: "alpha_ar_il_launch_01", content: "r01", path: "/learn-trading-free" },
  { id: "ig_s01", source: "instagram", medium: "organic_social", campaign: "alpha_ar_il_launch_01", content: "s01", path: "/learn-trading-free" },
  { id: "ig_r02", source: "instagram", medium: "organic_social", campaign: "alpha_ar_il_launch_01", content: "r02", path: "/buy-usdt-israel" },
  { id: "tt_bio", source: "tiktok", medium: "organic_social", campaign: "alpha_ar_il_launch_01", content: "bio", path: "/start" },
  { id: "tt_r01", source: "tiktok", medium: "organic_social", campaign: "alpha_ar_il_launch_01", content: "r01", path: "/learn-trading-free" },
  { id: "meta_academy_a", source: "meta", medium: "paid_social", campaign: "alpha_ar_il_launch_01", content: "academy_a", path: "/learn-trading-free" },
  { id: "meta_academy_b", source: "meta", medium: "paid_social", campaign: "alpha_ar_il_launch_01", content: "academy_b", path: "/learn-trading-free" },
  { id: "wa_m01", source: "whatsapp", medium: "community", campaign: "learn_with_mark_2026", content: "m01", path: "/learn-with-mark" },
  { id: "discord_m01", source: "discord", medium: "community", campaign: "learn_with_mark_2026", content: "m01", path: "/learn-with-mark" },
  { id: "ig_m01", source: "instagram", medium: "organic_social", campaign: "learn_with_mark_2026", content: "m01", path: "/learn-with-mark" },
  { id: "ig_m05", source: "instagram", medium: "organic_social", campaign: "learn_with_mark_2026", content: "m05", path: "/learn-with-mark" },
  { id: "tt_m01", source: "tiktok", medium: "organic_social", campaign: "learn_with_mark_2026", content: "m01", path: "/learn-with-mark" },
  { id: "friend_academy", source: "friend", medium: "word_of_mouth", campaign: "alpha_learning_2026", content: "academy", path: "/learn-trading-free" },
  { id: "friend_mentorship", source: "friend", medium: "word_of_mouth", campaign: "alpha_learning_2026", content: "mentorship", path: "/learn-with-mark" },
] as const;

export type LearningCampaignLink = typeof LEARNING_CAMPAIGN_LINKS[number];

export function learningCampaignLink(value: unknown): LearningCampaignLink | null {
  return typeof value === "string" ? LEARNING_CAMPAIGN_LINKS.find(link => link.id === value) ?? null : null;
}

export function learningCampaignUrl(link: LearningCampaignLink, locale: "en" | "ar" = "en"): string {
  const params = new URLSearchParams({ utm_source: link.source, utm_medium: link.medium, utm_campaign: link.campaign, utm_content: link.content });
  return `https://www.alphatraders.co.il/${locale}${link.path}?${params}`;
}
