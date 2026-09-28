// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredNewsProvider } from "./config";
import { newsEventId, newsEventStatus, shouldAlertForRelease } from "./model";
import { normalizeFxStreetNews } from "./fxstreet";

const now = new Date("2026-09-29T12:31:00Z");
const row = {
  id: "4fe1bd69-acce-4b24-9d54-f45c81708d29", eventId: "884ba498-c96b-4f3f-8797-0c711fc09248",
  name: "Consumer Price Index (MoM)", dateUtc: "2026-09-29T12:30:00Z", periodDateUtc: "2026-08-01T00:00:00Z",
  countryCode: "US", currencyCode: "USD", volatility: "HIGH", actual: 0, consensus: 0.2, previous: 0.3,
  revised: null, unit: "%", potency: "ZERO", isAllDay: false, isTentative: false, isSpeech: false,
  lastUpdated: Date.parse("2026-09-29T12:30:02Z") / 1000,
};
const licensed = { ECONOMIC_NEWS_PROVIDER: "fxstreet", ECONOMIC_NEWS_DATA_LICENSE_CONFIRMED: "true",
  ECONOMIC_NEWS_WHITE_LABEL_CONFIRMED: "true", FXSTREET_CLIENT_ID: "example-id", FXSTREET_CLIENT_SECRET: "example-secret" };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("FXStreet documented calendar contract", () => {
  it("requires server credentials and both redistribution and white-label confirmation", () => {
    expect(configuredNewsProvider(licensed)).toBe("fxstreet");
    for (const key of Object.keys(licensed)) expect(configuredNewsProvider({ ...licensed, [key]: "" })).toBeNull();
    expect(configuredNewsProvider({ ...licensed, ECONOMIC_NEWS_PROVIDER: "unknown" })).toBeNull();
  });
  it("retains zero, consensus, units, UTC seconds and Arabic titles without inventing publisher branding", () => {
    const [event] = normalizeFxStreetNews([row], now);
    expect(event).toMatchObject({ id: `fxs-${row.id}`, actual: "0%", forecast: "0.2%", previous: "0.3%", revised: null,
      titleAr: "مؤشر أسعار المستهلكين — شهري", providerUpdatedAt: "2026-09-29T12:30:02.000Z", source: "", sourceUrl: null });
    expect(newsEventStatus(event, now.getTime())).toBe("released");
    expect(normalizeFxStreetNews([{ ...row, actual: null }], now)[0].actual).toBeNull();
    expect(normalizeFxStreetNews([{ ...row, actual: 150, unit: "", potency: "K" }], now)[0].actual).toBe("150K");
  });
  it("filters non-US, non-USD and lower-impact data even if the remote filter is ignored", () => {
    expect(normalizeFxStreetNews([row, { ...row, countryCode: "CA" }, { ...row, currencyCode: "EUR" },
      { ...row, volatility: "MEDIUM" }], now)).toHaveLength(1);
  });
  it("does not invent release freshness or a precise all-day time", () => {
    const [unknown] = normalizeFxStreetNews([{ ...row, lastUpdated: null }], now);
    expect(unknown.providerUpdatedAt).toBeNull();
    expect(shouldAlertForRelease({ ...unknown, actual: null }, unknown, now.getTime(), true)).toBe(false);
    const [allDay] = normalizeFxStreetNews([{ ...row, isAllDay: true, actual: null }], now);
    expect(newsEventStatus(allDay, now.getTime())).toBe("tentative");
    const [speech] = normalizeFxStreetNews([{ ...row, actual: null, isSpeech: true }], now);
    expect(newsEventStatus(speech, now.getTime())).toBe("no_numeric_result");
  });
  it("uses occurrence IDs, keeps the newest duplicate and validates event deep links", () => {
    const [event] = normalizeFxStreetNews([{ ...row, actual: 0.4, lastUpdated: row.lastUpdated + 1 }, row], now);
    expect(event.actual).toBe("0.4%");
    expect(newsEventId(event.id)).toBe(event.id);
    expect(newsEventId("te-123")).toBe("te-123");
    for (const id of [row.id, "fxs-../../admin", "te-123?admin=true", [event.id]]) expect(newsEventId(id)).toBeUndefined();
    expect(() => normalizeFxStreetNews([{ ...row, id: "invalid" }], now)).toThrow();
    expect(() => normalizeFxStreetNews([{ ...row, dateUtc: "2026-09-29T12:30:00" }], now)).toThrow();
  });
});

describe("server-only FXStreet transport", () => {
  const tokenResponse = (value = "example-token") => Response.json({ access_token: value, token_type: "Bearer", expires_in: 86399 });
  const fetcher = async () => { vi.resetModules(); return (await import("./provider")).fetchEconomicNews; };
  const configure = () => { for (const [name, value] of Object.entries(licensed)) vi.stubEnv(name, value); };
  it("never calls the vendor before licensed activation", async () => {
    configure(); vi.stubEnv("ECONOMIC_NEWS_WHITE_LABEL_CONFIRMED", "false");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect((await fetcher())(now)).rejects.toThrow("not configured");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses documented OAuth, caches its token and bounds the country, impact and date window", async () => {
    configure();
    const fetch = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(Response.json([row, { ...row,
      id: "4fe1bd69-acce-4b24-9d54-f45c81708d30", dateUtc: "2026-12-01T12:30:00Z" }])).mockResolvedValueOnce(Response.json([row]));
    vi.stubGlobal("fetch", fetch);
    const get = await fetcher();
    expect(await get(now)).toHaveLength(1); await get(now);
    expect(fetch).toHaveBeenCalledTimes(3);
    const [authUrl, auth] = fetch.mock.calls[0];
    expect(authUrl).toBe("https://authorization.fxstreet.com/v2/token");
    expect(Object.fromEntries(auth.body)).toEqual({ grant_type: "client_credentials", client_id: "example-id", client_secret: "example-secret", scope: "calendar" });
    const [url, request] = fetch.mock.calls[1];
    expect(url.origin).toBe("https://calendar-api.fxstreet.com");
    expect(url.pathname).toBe("/en/api/v1/eventDates/2026-09-22T00:00:00.000Z/2026-10-06T23:59:59.999Z");
    expect(Object.fromEntries(url.searchParams)).toEqual({ countries: "US", volatilities: "HIGH" });
    expect(request).toMatchObject({ cache: "no-store", redirect: "error", headers: { Authorization: "Bearer example-token" } });
    expect(String(url)).not.toContain("example-secret");
  });
  it("refreshes once on 401 and stops on a second denial", async () => {
    configure();
    const fetch = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(tokenResponse("replacement-token")).mockResolvedValueOnce(new Response("denied", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await expect((await fetcher())(now)).rejects.toThrow("Economic news provider unavailable");
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("does not retry a licence denial or leak a sensitive upstream response", async () => {
    configure();
    const fetch = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response("example-secret", { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await expect((await fetcher())(now)).rejects.toThrow(/^Economic news provider unavailable$/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("renews an expiring token and drops it when credentials change", async () => {
    configure(); vi.useFakeTimers(); vi.setSystemTime(now);
    const fetch = vi.fn().mockImplementation(async (url) => String(url).includes("/v2/token") ? tokenResponse() : Response.json([row]));
    vi.stubGlobal("fetch", fetch); const get = await fetcher();
    await get(now); vi.setSystemTime(new Date(now.getTime() + 86_340_000)); await get(now);
    vi.stubEnv("FXSTREET_CLIENT_SECRET", "changed-secret"); await get(now);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("/v2/token"))).toHaveLength(3);
  });
  it("rejects oversized and malformed payloads without returning partial news", async () => {
    configure();
    const fetch = vi.fn().mockResolvedValueOnce(tokenResponse()).mockResolvedValueOnce(new Response("[]", { headers: { "content-length": "2000001" } }));
    vi.stubGlobal("fetch", fetch); const get = await fetcher();
    await expect(get(now)).rejects.toThrow(/^Economic news provider unavailable$/);
    fetch.mockResolvedValueOnce(Response.json([{ ...row, actual: "secret invalid data" }]));
    await expect(get(now)).rejects.toThrow(/^Economic news provider unavailable$/);
  });
});
