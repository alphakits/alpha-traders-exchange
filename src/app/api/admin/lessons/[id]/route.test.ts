// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const auth = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
vi.mock("@/lib/admin-auth", () => ({ resolveAdminIdentity: auth.resolve, adminErrorStatus: (error: Error) => error.message === "Unauthorized admin access." ? 401 : 400 }));
import { createLesson, readLessons, readVersions } from "@/lib/admin-store";
import { getAdminContentRepository } from "@/lib/admin-content-repository";
import { PUT } from "./route";
const content = { id: "target", title: "Original", titleAr: "أصلي", description: "Description", descriptionAr: "الوصف", summary: "Summary", summaryAr: "ملخص", status: "draft" as const, courseId: "c1" };
const save = (lesson: Record<string, unknown>) => PUT(new NextRequest("https://www.alphatraders.co.il/api/admin/lessons/target", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ lesson }) }), { params: Promise.resolve({ id: "target" }) });
beforeEach(async () => {
  vi.restoreAllMocks(); auth.resolve.mockResolvedValue({ role: "admin", actor: "synthetic-owner@example.test" });
  globalThis.__adminContentRepositoryPromise = undefined;
  globalThis.__adminContentMemorySnapshot = { lessons: [], versions: [], media: [] };
  await createLesson(content, "admin");
});
describe("owner lesson API persistence", () => {
  it("saves every edited field when the editor includes its current draft status", async () => {
    const response = await save({ ...content, title: "Edited", description: "Edited description", durationMinutes: 25 });
    expect(response.status).toBe(200);
    expect((await readLessons())[0]).toMatchObject({ title: "Edited", description: "Edited description", durationMinutes: 25 });
    expect((await response.json()).lesson.title).toBe("Edited");
  });
  it("publishes the submitted bilingual content and its audit atomically", async () => {
    const response = await save({ ...content, title: "Published edit", titleAr: "نص منشور", status: "published" });
    expect(response.status).toBe(200);
    expect((await readLessons())[0]).toMatchObject({ title: "Published edit", titleAr: "نص منشور", status: "published" });
    expect((await readVersions()).find(row => row.action === "published")?.snapshot?.title).toBe("Published edit");
  });
  it("rejects a body ID that disagrees with the URL", async () => {
    await createLesson({ ...content, id: "other" }, "admin");
    expect((await save({ id: "other", title: "Wrong target" })).status).toBe(400);
    expect((await readLessons()).map(row => row.title)).toEqual(["Original", "Original"]);
  });
  it("rejects an unsupported status without silently publishing", async () => {
    expect((await save({ status: "unexpected" })).status).toBe(400);
    expect((await readLessons())[0].status).toBe("draft");
  });
  it("does not save when owner authorization is absent", async () => {
    auth.resolve.mockRejectedValueOnce(new Error("Unauthorized admin access."));
    expect((await save({ title: "Unauthorized" })).status).toBe(401);
    expect((await readLessons())[0].title).toBe("Original");
  });
  it("returns an error and retains old content when version persistence fails", async () => {
    vi.spyOn(await getAdminContentRepository(), "saveVersions").mockRejectedValueOnce(new Error("controlled audit failure"));
    expect((await save({ ...content, title: "Failed save" })).status).toBe(400);
    expect((await readLessons())[0].title).toBe("Original");
    expect(await readVersions()).toHaveLength(1);
  });
});
