import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Lesson } from "@/types/academy";
import { LessonManagementDashboard } from "./lesson-management-dashboard";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));
const capture = vi.hoisted(() => ({ enqueue: vi.fn(), deferSavedDisplay: false, savedDisplay: [] as (() => void)[] }));
vi.mock("@/lib/queued-autosave", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/queued-autosave")>();
  return { createQueuedAutosave: (options: Parameters<typeof actual.createQueuedAutosave>[0]) => {
    const display = (callback: () => void) => capture.deferSavedDisplay ? capture.savedDisplay.push(callback) : callback();
    const queue = actual.createQueuedAutosave({ ...options,
      onAcknowledged: value => display(() => options.onAcknowledged?.(value)),
      onSaved: value => display(() => options.onSaved(value)),
    });
    return { ...queue, enqueue: (value: Lesson) => { capture.enqueue(value); queue.enqueue(value); } };
  } };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); capture.enqueue.mockClear(); capture.deferSavedDisplay = false; capture.savedDisplay = []; });

it("publishes with the acknowledged version before its saved display catches up", async () => {
  vi.useFakeTimers();
  capture.deferSavedDisplay = true;
  const lesson = { id: "acknowledged-editor", title: "Original", titleAr: "عنوان", description: "Description", descriptionAr: "وصف", summary: "Summary", summaryAr: "ملخص", slug: "acknowledged-editor", courseId: "c1", status: "draft", category: "beginner", order: 1, durationMinutes: 1, updatedAt: "2026-10-23T14:22:06.590Z", assets: { resources: [], videoChapters: [] }, quiz: [], objectives: [], objectivesAr: [], takeaways: [], takeawaysAr: [], keywords: [], keywordsAr: [], tags: [], tagsAr: [] } as unknown as Lesson;
  let saved = lesson;
  const writes: Lesson[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const value = JSON.parse(String(init.body)).lesson as Lesson; writes.push(value);
      if (value.updatedAt !== saved.updatedAt) return { ok: false, status: 409, json: async () => ({ currentLesson: saved }) };
      saved = { ...value, updatedAt: `2026-10-23T14:22:${10 + writes.length}.997Z` };
      return { ok: true, json: async () => ({ lesson: saved }) };
    }
    return { ok: true, json: async () => ({ lessons: [lesson], media: [], versions: [], courses: [], analytics: null }) };
  }));
  await act(async () => { render(<LessonManagementDashboard />); });
  fireEvent.change(screen.getByLabelText("English title"), { target: { value: "Published edit" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(writes).toHaveLength(1);
  expect(saved.status).toBe("draft");
  fireEvent.click(screen.getByRole("button", { name: /^Publish$/ }));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(saved).toMatchObject({ title: "Published edit", status: "published" });
  expect(writes[1].updatedAt).toBe("2026-10-23T14:22:11.997Z");
  act(() => { capture.savedDisplay.splice(0).forEach(callback => callback()); });
  expect(screen.queryByText(/This lesson changed/)).toBeNull();
});

it("preserves a newer server refresh when an earlier saved display is deferred", async () => {
  vi.useFakeTimers();
  capture.deferSavedDisplay = true;
  const lesson = { id: "refreshed-editor", title: "Original", titleAr: "عنوان", description: "Description", descriptionAr: "وصف", summary: "Summary", summaryAr: "ملخص", slug: "refreshed-editor", courseId: "c1", status: "draft", category: "beginner", order: 1, durationMinutes: 1, updatedAt: "2026-10-23T14:22:06.590Z", assets: { resources: [], videoChapters: [] }, quiz: [], objectives: [], objectivesAr: [], takeaways: [], takeawaysAr: [], keywords: [], keywordsAr: [], tags: [], tagsAr: [] } as unknown as Lesson;
  let saved = lesson;
  const writes: Lesson[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const value = JSON.parse(String(init.body)).lesson as Lesson; writes.push(value);
      if (value.updatedAt !== saved.updatedAt) return { ok: false, status: 409, json: async () => ({ currentLesson: saved }) };
      saved = { ...value, updatedAt: `2026-10-23T14:22:${10 + writes.length * 10}.997Z` };
      return { ok: true, json: async () => ({ lesson: saved }) };
    }
    return { ok: true, json: async () => ({ lessons: [saved], media: [], versions: [], courses: [], analytics: null }) };
  }));
  await act(async () => { render(<LessonManagementDashboard />); });
  fireEvent.change(screen.getByLabelText("English title"), { target: { value: "Local autosave" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(writes).toHaveLength(1);
  saved = { ...saved, title: "Newer server title", updatedAt: "2026-10-23T14:22:25.997Z" };
  await act(async () => { fireEvent.change(screen.getByPlaceholderText("ADMIN_ACCESS_KEY"), { target: { value: "synthetic-refresh" } }); });
  expect((screen.getByLabelText("English title") as HTMLInputElement).value).toBe("Newer server title");
  act(() => { capture.savedDisplay.splice(0).forEach(callback => callback()); });
  expect((screen.getByLabelText("English title") as HTMLInputElement).value).toBe("Newer server title");
  fireEvent.click(screen.getByRole("button", { name: /^Publish$/ }));
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(writes[1]).toMatchObject({ title: "Newer server title", status: "published", updatedAt: "2026-10-23T14:22:25.997Z" });
  expect(saved.status).toBe("published");
});

it("queues Publish before deferred React effects can consume an older draft", async () => {
  vi.useFakeTimers();
  const lesson = { id: "controlled-editor", title: "Original", titleAr: "عنوان", description: "Description", descriptionAr: "وصف", summary: "Summary", summaryAr: "ملخص", slug: "controlled-editor", courseId: "c1", status: "draft", category: "beginner", order: 1, durationMinutes: 1, updatedAt: "1", assets: { resources: [], videoChapters: [] }, quiz: [], objectives: [], objectivesAr: [], takeaways: [], takeawaysAr: [], keywords: [], keywordsAr: [], tags: [], tagsAr: [] } as unknown as Lesson;
  const writes: Lesson[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const value = JSON.parse(String(init.body)).lesson as Lesson; writes.push(value);
      return { ok: true, json: async () => ({ lesson: { ...value, updatedAt: String(writes.length + 1) } }) };
    }
    return { ok: true, json: async () => ({ lessons: [lesson], media: [], versions: [], courses: [], analytics: null }) };
  }));
  await act(async () => { render(<LessonManagementDashboard />); });
  fireEvent.change(screen.getByLabelText("English title"), { target: { value: "Edited title" } });
  act(() => {
    screen.getByRole("button", { name: /^Publish$/ }).click();
    // The domain queue must own the command before React commits its display.
    expect(capture.enqueue.mock.lastCall?.[0]).toMatchObject({ title: "Edited title", status: "published" });
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ title: "Edited title", status: "published" });
});
