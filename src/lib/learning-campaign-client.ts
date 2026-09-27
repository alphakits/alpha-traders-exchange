import { LEARNING_CAMPAIGN_LINKS, learningCampaignLink, type LearningCampaignLink } from "@/lib/learning-campaign";

export const LEARNING_CAMPAIGN_STORAGE_KEY = "alpha_learning_campaign_v1";
export const LEARNING_CAMPAIGN_TTL_MS = 30 * 60 * 1000;
const UTM_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;

type CampaignBrowser = {
  location: Pick<Location, "search">;
  sessionStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  navigator: { doNotTrack?: string | null; globalPrivacyControl?: boolean };
  doNotTrack?: string;
};

/** Last recognised link in this tab for at most 30 minutes; not verified ad attribution. */
export function readLearningCampaign(browser: CampaignBrowser, now = Date.now()): LearningCampaignLink["id"] | null {
  try {
    if (browser.navigator.globalPrivacyControl === true
      || /^(1|yes)$/i.test(browser.navigator.doNotTrack ?? "")
      || /^(1|yes)$/i.test(browser.doNotTrack ?? "")) {
      // Remove any earlier preference-era code, without reading or sending it.
      try { browser.sessionStorage.removeItem(LEARNING_CAMPAIGN_STORAGE_KEY); } catch { /* blocked storage */ }
      return null;
    }

    const params = new URLSearchParams(browser.location.search);
    if (UTM_FIELDS.some(field => params.has(field))) {
      const duplicate = UTM_FIELDS.some(field => params.getAll(field).length !== 1);
      const link = duplicate ? null : LEARNING_CAMPAIGN_LINKS.find(candidate =>
        candidate.source === params.get("utm_source") && candidate.medium === params.get("utm_medium")
        && candidate.campaign === params.get("utm_campaign") && candidate.content === params.get("utm_content"));
      if (!link) {
        browser.sessionStorage.removeItem(LEARNING_CAMPAIGN_STORAGE_KEY);
        return null;
      }
      // Persist only an allowlisted code and age. Never URLs, search terms or identifiers.
      browser.sessionStorage.setItem(LEARNING_CAMPAIGN_STORAGE_KEY, JSON.stringify({ id: link.id, at: now }));
      return link.id;
    }

    const raw = browser.sessionStorage.getItem(LEARNING_CAMPAIGN_STORAGE_KEY);
    if (!raw) return null;
    let stored: { id?: unknown; at?: unknown } | null = null;
    try { stored = JSON.parse(raw); } catch { /* discarded below */ }
    const link = learningCampaignLink(stored?.id);
    if (!link || typeof stored?.at !== "number" || !Number.isFinite(stored.at)
      || stored.at > now || now - stored.at >= LEARNING_CAMPAIGN_TTL_MS) {
      browser.sessionStorage.removeItem(LEARNING_CAMPAIGN_STORAGE_KEY);
      return null;
    }
    return link.id;
  } catch {
    // Optional measurement must never prevent navigation or an enquiry.
    return null;
  }
}
