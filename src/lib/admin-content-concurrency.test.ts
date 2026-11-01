// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => null }));
import { addMediaItem, createLesson, duplicateLesson, readLessons, readMediaLibrary, readVersions, setLessonStatus, updateLesson } from "./admin-store";
import { getAdminContentRepository } from "./admin-content-repository";

beforeEach(() => {
  vi.restoreAllMocks(); vi.useRealTimers();
  globalThis.__adminContentRepositoryPromise = undefined;
  globalThis.__adminContentMemorySnapshot = { lessons: [], versions: [], media: [] };
});
const draft = (id: string) => ({ id, title: id, courseId: "c1", status: "draft" as const });
describe("owner content concurrent edits", () => {
  it("retains both simultaneous lesson creations and their audit entries", async () => {
    await Promise.all([createLesson(draft("first"), "admin"), createLesson(draft("second"), "admin")]);
    expect((await readLessons()).map(row => row.id).sort()).toEqual(["first", "second"]);
    expect((await readVersions()).map(row => row.lessonId).sort()).toEqual(["first", "second"]);
  });
  it("retains independent field changes submitted from two owner tabs", async () => {
    await createLesson(draft("one"), "admin");
    await Promise.all([updateLesson({ id: "one", title: "New title" }, "admin"), updateLesson({ id: "one", description: "New description" }, "admin")]);
    expect((await readLessons())[0]).toMatchObject({ title: "New title", description: "New description" });
    expect((await readVersions()).filter(row => row.action === "updated")).toHaveLength(2);
  });
  it("rolls back lesson creation when its audit write fails", async () => {
    const repository = await getAdminContentRepository();
    vi.spyOn(repository, "saveVersions").mockRejectedValueOnce(new Error("controlled audit write failure"));
    await expect(createLesson(draft("failed"), "admin")).rejects.toThrow("controlled audit");
    expect(await readLessons()).toEqual([]);
    expect(await readVersions()).toEqual([]);
    await createLesson(draft("recovered"), "admin");
    expect((await readLessons()).map(row => row.id)).toEqual(["recovered"]);
  });
  it("rolls back a status change if its publication audit cannot be recorded", async () => {
    await createLesson(draft("one"), "admin");
    const repository = await getAdminContentRepository();
    const save = repository.saveVersions.bind(repository);
    vi.spyOn(repository, "saveVersions").mockImplementation(async versions => {
      if (versions.some(row => row.action === "unpublished")) throw new Error("controlled publication audit failure");
      return save(versions);
    });
    const before = await readVersions();
    await expect(setLessonStatus("one", "draft", "admin")).rejects.toThrow("controlled publication");
    expect(await readVersions()).toEqual(before);
  });
  it("generates distinct duplicate identities when requests share a timestamp", async () => {
    await createLesson(draft("source"), "admin");
    vi.spyOn(Date, "now").mockReturnValue(1792195200000);
    await Promise.all([duplicateLesson("source", "admin"), duplicateLesson("source", "admin")]);
    const lessons = await readLessons();
    expect(lessons).toHaveLength(3);
    expect(new Set(lessons.map(row => row.id)).size).toBe(3);
    expect(new Set(lessons.map(row => row.slug)).size).toBe(3);
  });
  it("preserves simultaneous media additions and association changes", async () => {
    const base = { type: "pdf" as const, provider: "local" as const, name: "Synthetic", url: "/synthetic.pdf" };
    await Promise.all([addMediaItem({ ...base, lessonId: "first" }), addMediaItem({ ...base, lessonId: "second" })]);
    const media = await readMediaLibrary();
    expect(media).toHaveLength(1);
    expect(media[0].usedByLessonIds.sort()).toEqual(["first", "second"]);
  });
});
