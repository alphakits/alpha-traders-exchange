// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), readLessons: vi.fn(), readMedia: vi.fn(), readVersions: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentSessionUser: mocks.session }));
vi.mock("@/lib/admin-store", () => ({
  readLessons: mocks.readLessons, readMediaLibrary: mocks.readMedia, readVersions: mocks.readVersions,
  buildAnalytics: () => ({ totalLessons: 1 }),
  searchLessons: (lessons: unknown[]) => lessons,
  toCsv: () => "id,title\nprivate-lesson,Private draft\n",
}));

import { GET as bootstrap } from "@/app/api/admin/bootstrap/route";
import { GET as lessons } from "@/app/api/admin/lessons/route";
import { GET as media } from "@/app/api/admin/media/route";
import { GET as versions } from "@/app/api/admin/versions/route";
import { GET as exportLessons } from "@/app/api/admin/export/route";

const reads = [
  ["bootstrap", bootstrap], ["lessons", lessons], ["media", media],
  ["versions", versions], ["export", exportLessons],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_ACCESS_KEY", "");
  mocks.session.mockResolvedValue({ id: "owner-audit", email: "owner@example.test", role: "owner", roles: ["owner"] });
  mocks.readLessons.mockResolvedValue([{ id: "private-lesson", title: "Private draft", status: "draft" }]);
  mocks.readMedia.mockResolvedValue([{ id: "private-media" }]);
  mocks.readVersions.mockResolvedValue([{ id: "private-version" }]);
});
afterEach(() => vi.unstubAllEnvs());

function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  const vary = response.headers.get("vary")?.toLowerCase().split(/,\s*/);
  expect(vary).toEqual(expect.arrayContaining(["cookie", "x-admin-key"]));
}

describe("academy admin response privacy", () => {
  it.each(reads)("does not cache a signed-out %s denial or read private content", async (path, get) => {
    mocks.session.mockResolvedValue(null);
    const response = await get(new NextRequest(`https://example.test/api/admin/${path}`));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized admin access." });
    expectPrivate(response);
    expect(mocks.readLessons).not.toHaveBeenCalled();
    expect(mocks.readMedia).not.toHaveBeenCalled();
    expect(mocks.readVersions).not.toHaveBeenCalled();
  });

  it.each(reads)("does not store the authenticated %s response", async (path, get) => {
    const response = await get(new NextRequest(`https://example.test/api/admin/${path}`));
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(await response.json()).toBeTruthy();
  });

  it.each(["csv", "backup", "json"])("preserves the %s export while preventing cached copies", async format => {
    const response = await exportLessons(new NextRequest(`https://example.test/api/admin/export?format=${format}`));
    expect(response.status).toBe(200);
    expectPrivate(response);
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("content-type")).toContain(format === "csv" ? "text/csv" : "application/json");
    expect(await response.text()).toContain("private-lesson");
  });
});
