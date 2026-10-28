// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import snapshot from "./weekly-calendar.json";
import { weeklyCalendarSchema } from "./weekly-schema";
const mocks = vi.hoisted(() => ({ acquire: vi.fn(), read: vi.fn(), save: vi.fn(), collect: vi.fn(), log: vi.fn() }));
vi.mock("./official-storage", () => ({ acquireOfficialNewsLease: mocks.acquire, readOfficialResults: mocks.read, saveOfficialResults: mocks.save }));
vi.mock("./official-fetch", () => ({ collectOfficialResults: mocks.collect }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: mocks.log }));
import { runOfficialNewsSync } from "./official-worker";
const calendar = weeklyCalendarSchema.parse(snapshot);
const releaseTime = Date.parse("2026-10-29T12:30:00Z");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.acquire.mockResolvedValue({ pool: {}, token: "fixture" });
  mocks.read.mockResolvedValue({ calendar });
  mocks.save.mockResolvedValue(1);
  mocks.collect.mockResolvedValue({ results: [], checked: [], failed: [], pending: [], unsupported: [] });
});
afterEach(() => vi.restoreAllMocks());

describe("one-minute official News worker", () => {
  it("can collect a newly due release on the next minute without any deploy or alert path", async () => {
    vi.spyOn(Date, "now").mockReturnValue(releaseTime + 60_000);
    await runOfficialNewsSync(releaseTime - 1);
    expect(mocks.collect.mock.calls[0][0].some((e: { id: string }) => e.id === "official-dol-initial-claims-20261029")).toBe(false);
    expect(await runOfficialNewsSync(releaseTime + 60_000)).toMatchObject({ status: "ready", synced: true, sent: 0 });
    expect(mocks.collect.mock.calls[1][0].some((e: { id: string }) => e.id === "official-dol-initial-claims-20261029")).toBe(true);
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });
  it("retries a late unpublished report every minute while checking older results hourly", async () => {
    const pending = structuredClone(calendar);
    const old = pending.events.find(e => e.id === "official-dol-initial-claims-20261022")!;
    old.actual = null; old.publishedAt = null;
    mocks.read.mockResolvedValue({ calendar: pending });
    await runOfficialNewsSync(releaseTime + 60_000);
    expect(mocks.collect.mock.calls[0][0].some((e: { id: string }) => e.id === old.id)).toBe(true);
    mocks.read.mockResolvedValue({ calendar });
    await runOfficialNewsSync(releaseTime + 60_000);
    expect(mocks.collect.mock.calls[1][0].some((e: { id: string }) => e.id === old.id)).toBe(false);
    await runOfficialNewsSync(Date.parse("2026-10-29T13:00:00Z"));
    expect(mocks.collect.mock.calls[2][0].some((e: { id: string }) => e.id === old.id)).toBe(true);
  });
  it("does no source work after losing a lease or outside verified calendar coverage", async () => {
    mocks.acquire.mockResolvedValue(null);
    expect(await runOfficialNewsSync(releaseTime)).toMatchObject({ synced: false });
    expect(await runOfficialNewsSync(Date.parse(calendar.coverageEnd))).toMatchObject({ synced: false });
    expect(mocks.collect).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("reports source failures without inventing or clearing any result", async () => {
    const failure = { results: [], checked: [], failed: ["official-dol-initial-claims-20261029"], pending: [], unsupported: ["speech"] };
    mocks.collect.mockResolvedValue(failure); mocks.save.mockResolvedValue(0);
    expect(await runOfficialNewsSync(releaseTime + 60_000)).toMatchObject({ status: "partial", releases: 0, failed: 1, sent: 0, editorialPending: 1 });
    expect(mocks.save.mock.calls[0][2]).toEqual([]);
    expect(mocks.log).toHaveBeenCalledWith("warn", expect.objectContaining({ event: "official_news_sync" }));
  });
});
