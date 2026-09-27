import { describe, expect, it } from "vitest";
import { LEARNING_CAMPAIGN_LINKS, learningCampaignLink, learningCampaignUrl } from "@/lib/learning-campaign";
import { readLearningCampaign, LEARNING_CAMPAIGN_STORAGE_KEY as KEY, LEARNING_CAMPAIGN_TTL_MS as TTL } from "@/lib/learning-campaign-client";

function browser(search = "") {
  const values = new Map<string, string>();
  return {
    location: { search }, navigator: { doNotTrack: "", globalPrivacyControl: false }, doNotTrack: "",
    sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } },
  };
}
const query = (index = 0) => new URL(learningCampaignUrl(LEARNING_CAMPAIGN_LINKS[index])).search;

describe("limited learning campaign attribution", () => {
  it("recognises every campaign URL using a unique code, storing no URL or personal query fields", () => {
    expect(new Set(LEARNING_CAMPAIGN_LINKS.map(link => link.id)).size).toBe(LEARNING_CAMPAIGN_LINKS.length);
    for (const [index, link] of LEARNING_CAMPAIGN_LINKS.entries()) {
      const b = browser(query(index) + "&email=private%40example.test&fbclid=secret&utm_term=private");
      expect(readLearningCampaign(b, 10)).toBe(link.id);
      expect(JSON.parse(b.sessionStorage.getItem(KEY)!)).toEqual({ id: link.id, at: 10 });
    }
  });
  it("survives internal navigation, expires at 30 minutes, and updates on a new recognised link", () => {
    const b = browser(query());
    expect(readLearningCampaign(b, 1)).toBe("ig_bio");
    b.location.search = "";
    expect(readLearningCampaign(b, TTL)).toBe("ig_bio");
    expect(readLearningCampaign(b, TTL + 1)).toBeNull();
    b.location.search = query(4);
    expect(readLearningCampaign(b, TTL + 2)).toBe("tt_bio");
  });
  it.each(["navigatorDnt", "windowDnt", "gpc"])("honours %s and removes a previously stored code", choice => {
    const b = browser(query()); readLearningCampaign(b, 1);
    if (choice === "navigatorDnt") b.navigator.doNotTrack = "1";
    else if (choice === "windowDnt") b.doNotTrack = "yes";
    else b.navigator.globalPrivacyControl = true;
    expect(readLearningCampaign(b, 2)).toBeNull();
    expect(b.sessionStorage.getItem(KEY)).toBeNull();
  });
  it("clears old attribution for unknown, partial or duplicated campaign tags", () => {
    for (const search of ["?utm_source=unknown", query() + "&utm_source=instagram", query().replace("instagram", "private%40example.test")]) {
      const b = browser(query()); readLearningCampaign(b, 1); b.location.search = search;
      expect(readLearningCampaign(b, 2)).toBeNull();
      expect(b.sessionStorage.getItem(KEY)).toBeNull();
    }
  });
  it("ignores corrupt, future-dated and forged codes and handles blocked storage", () => {
    for (const raw of ["{", "null", '{"id":"__proto__","at":1}', '{"id":"ig_bio","at":999}']) {
      const b = browser(); b.sessionStorage.setItem(KEY, raw);
      expect(readLearningCampaign(b, 2)).toBeNull();
    }
    const b = browser(query()); Object.defineProperty(b, "sessionStorage", { get: () => { throw new Error("blocked"); } });
    expect(readLearningCampaign(b, 1)).toBeNull();
    expect(learningCampaignLink("__proto__")).toBeNull();
    expect(learningCampaignLink({ id: "ig_bio" })).toBeNull();
  });
});
