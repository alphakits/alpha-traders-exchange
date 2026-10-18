import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Lesson } from "@/types/academy";
import { LessonManagementDashboard } from "./lesson-management-dashboard";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));
const capture = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("@/lib/queued-autosave", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/queued-autosave")>();
  return { createQueuedAutosave: (options: Parameters<typeof actual.createQueuedAutosave>[0]) => {
    const queue = actual.createQueuedAutosave(options);
    return { ...queue, enqueue: (value: Lesson) => { capture.enqueue(value); queue.enqueue(value); } };
  } };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); capture.enqueue.mockClear(); });

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
