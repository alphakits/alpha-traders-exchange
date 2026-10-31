// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import snapshot from "./weekly-calendar.json";
import { weeklyCalendarSchema } from "./weekly-schema";
import { allowedOfficialUrl, collectOfficialResults, fetchOfficialDocument } from "./official-fetch";
import type { OfficialDocument } from "./official-sources";

const calendar = weeklyCalendarSchema.parse(snapshot);
const event = (part: string) => calendar.events.find(e => e.id.includes(part))!;
const cpi = "Transmission embargoed until 8:30 a.m. (ET) Wednesday, October 14, 2026 CONSUMER PRICE INDEX - SEPTEMBER 2026 The Consumer Price Index for All Urban Consumers (CPI-U) increased 0.6 percent on a seasonally adjusted basis in September. The index for all items less food and energy rose 0.3 percent in September.";
const doc = (url: string, text: string, html?: string): OfficialDocument => ({ url, text, html, sha256: "b".repeat(64) });
afterEach(() => vi.unstubAllGlobals());

describe("bounded official-source transport and isolation", () => {
  it.each(["http://www.bls.gov/", "https://www.bls.gov.evil.test/", "https://user:pass@www.bls.gov/", "https://www.bls.gov:8000/", "https://127.0.0.1/", "file:///etc/passwd"])("rejects unapproved URL %s before any network", async url => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(allowedOfficialUrl(url)).toBe(false);
    await expect(fetchOfficialDocument(url, new AbortController().signal)).rejects.toThrow("Unapproved");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses fresh no-store requests, disables redirects, and hashes source bytes", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("<p>Official &amp; verified</p>", { headers: { "Content-Type": "text/html" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchOfficialDocument("https://www.bls.gov/news.release/cpi.nr0.htm", new AbortController().signal)).toMatchObject({ text: "Official & verified", sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: "error", cache: "no-store", signal: expect.any(AbortSignal) }));
  });
  it.each([
    () => new Response("not yet", { status: 404 }),
    () => new Response("oversized", { headers: { "Content-Length": String(5 * 1024 * 1024) } }),
    () => new Response(new Uint8Array(4 * 1024 * 1024 + 1)),
    () => new Response("not a release", { headers: { "Content-Type": "application/octet-stream" } }),
  ])("fails closed on errors, oversized bodies and unsupported types", async response => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
    await expect(fetchOfficialDocument("https://www.dol.gov/ui/data.pdf", new AbortController().signal)).rejects.toThrow();
  });
  it("deduplicates shared publications while preserving independent successes and failures", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("dol.gov")) throw new Error("unavailable");
      return doc(url, cpi);
    });
    const events = [event("core-cpi-mom-20261014"), event("-cpi-mom-20261014"), event("initial-claims-20261022"), event("press-conference")];
    // The broad title lookup above may find the core series first; choose exact ID.
    events[1] = calendar.events.find(e => e.id === "official-bls-cpi-mom-20261014")!;
    const found = await collectOfficialResults(events, Date.parse("2026-10-28T19:00:00Z"), fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(found.results.map(r => r.event.actual)).toEqual(["0.3%", "0.6%"]);
    expect(found.failed).toEqual([events[2].id]);
    expect(found.unsupported).toEqual([events[3].id]);
  });
  it.each(["gdp-advance-estimate-3rd-quarter-2026", "gross-domestic-product-third-quarter-2026-advance-estimate"])("discovers a dated GDP link: %s", async slug => {
    const releaseUrl = `https://www.bea.gov/news/2026/${slug}`;
    const text = "EMBARGOED UNTIL RELEASE AT 8:30 a.m. EDT Thursday, October 29, 2026 GDP (Advance Estimate), 3rd Quarter 2026 Real gross domestic product (GDP) increased at an annual rate of 2.1 percent in the third quarter of 2026.";
    const fetcher = vi.fn(async (url: string) => url.endsWith("current-releases") ? doc(url, "", `<a href="${releaseUrl}">GDP</a>`) : doc(url, text));
    const found = await collectOfficialResults([event("gdp-advance")], Date.parse("2026-10-29T13:00:00Z"), fetcher);
    expect(found.results[0]?.event).toMatchObject({ actual: "2.1%", sourceUrl: releaseUrl });
  });
  it("does not treat a schedule or a newer current release as publication", async () => {
    const found = await collectOfficialResults([event("initial-claims-20261022")], Date.parse("2026-10-29T13:00:00Z"), async url => doc(url, cpi));
    expect(found.results).toEqual([]);
    expect(found.pending).toEqual([event("initial-claims-20261022").id]);
  });
});
