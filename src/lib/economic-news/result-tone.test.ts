import { describe, expect, it } from "vitest";
import type { NewsEvent } from "./model";
import { newsResultMeaning } from "./result-tone";

const now = Date.parse("2026-10-09T00:00:00Z");
const event: NewsEvent = {
  id: "official-bls-jobs-20261002", providerId: "jobs", title: "Nonfarm payrolls", titleAr: "الوظائف",
  scheduledAt: "2026-10-02T12:30:00Z", currency: "USD", impact: "high", actual: "29K", forecast: null,
  previous: "162K", revised: "133K", reference: null, source: "BLS", sourceUrl: "https://www.bls.gov/",
  providerUpdatedAt: null, syncedAt: "2026-10-09T00:00:00Z", timing: "exact", kind: "release",
};
const meaning = (changes: Partial<NewsEvent>) => newsResultMeaning({ ...event, ...changes }, "en", now);

describe("News result colors", () => {
  it.each(["-105.6B", "−105.6B", "$-70.5B", "-$70.5B", "−$70.5B", "-0.2%"])("keeps the negative value %s red", actual => {
    expect(meaning({ actual })).toEqual({ tone: "negative", label: "Negative value" });
  });
  it.each(["+0.2%", "+150K", "$+1.5B", "+$1.5B"])("keeps the explicit positive value %s green", actual => {
    expect(meaning({ actual })).toEqual({ tone: "positive", label: "Positive value" });
  });
  it("uses revised previous rather than the superseded value", () => {
    expect(meaning({})).toEqual({ tone: "negative", label: "Below revised previous" });
    expect(meaning({ title: "Initial jobless claims", actual: "197K", previous: "197K", revised: "199K" }))
      .toEqual({ tone: "positive", label: "Below revised previous" });
  });
  it("reverses the color for rising unemployment and claims", () => {
    expect(meaning({ title: "Unemployment rate", actual: "4.3%", previous: "4.2%", revised: null }).tone).toBe("negative");
    expect(meaning({ title: "Initial jobless claims", actual: "210K", previous: "200K", revised: null }).tone).toBe("negative");
    expect(meaning({ title: "Unemployment rate", actual: "4.1%", previous: "4.2%", revised: null }).tone).toBe("positive");
  });
  it("uses an available forecast ahead of historical comparisons", () => {
    expect(meaning({ actual: "150K", forecast: "140K", previous: "180K", revised: "170K" }))
      .toEqual({ tone: "positive", label: "Above forecast" });
    expect(meaning({ title: "Initial jobless claims", actual: "150K", forecast: "140K" }).tone).toBe("negative");
  });
  it("compares compatible scales and correctly formatted grouped numbers", () => {
    expect(meaning({ actual: "150K", forecast: "0.15M" })).toEqual({ tone: "neutral", label: "In line with forecast" });
    expect(meaning({ actual: "150,001", forecast: "0.15M" }).tone).toBe("positive");
  });
  it("never compares incompatible units or accepts a partial numeric parse", () => {
    expect(meaning({ actual: "0.2%", forecast: "150K", revised: null, previous: "0.3%" }))
      .toEqual({ tone: "negative", label: "Below previous" });
    for (const actual of [null, "", "N/A", "--", "3.75–4%", "1,23K", "1.2% revised", "Infinity"]) {
      expect(meaning({ actual }).tone).toBe("neutral");
    }
  });
  it("preserves zero as a real result and keeps equal readings neutral", () => {
    expect(meaning({ actual: "0", forecast: "0" })).toEqual({ tone: "neutral", label: "In line with forecast" });
    expect(meaning({ actual: "-0%", forecast: null, previous: null, revised: null })).toEqual({ tone: "neutral", label: "Zero" });
    expect(meaning({ actual: "29K", forecast: null, previous: "29K", revised: null }).tone).toBe("neutral");
  });
  it.each(["CPI m/m", "PPI MoM", "Fed interest rate decision", "Average hourly earnings", "GDP Price Index", "GDP Deflator", "Gross domestic product price index", "Unknown series"])("does not invent good/bad news for %s", title => {
    expect(meaning({ title, actual: "4%", forecast: "3%" })).toEqual({ tone: "neutral", label: "Context dependent" });
  });
  it("never colors future or unpublished data as an outcome", () => {
    expect(meaning({ actual: "-1%", scheduledAt: "2026-10-10T12:30:00Z" }).tone).toBe("neutral");
    expect(meaning({ actual: "+1%", publishedAt: "2026-10-10T12:30:00Z" }).tone).toBe("neutral");
    expect(meaning({ kind: "speech", actual: "+1%" }).tone).toBe("neutral");
  });
  it("provides an Arabic comparison label without changing the underlying result", () => {
    expect(newsResultMeaning(event, "ar", now)).toEqual({ tone: "negative", label: "أقل من السابق المعدّل" });
    expect(event.actual).toBe("29K");
  });
});
