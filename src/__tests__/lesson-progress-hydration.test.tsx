import React, { act, type ComponentProps } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testLocale = vi.hoisted(() => ({ value: "en" }));
vi.mock("next-intl", () => ({ useLocale: () => testLocale.value }));
vi.mock("@/i18n/navigation", () => ({ Link: (props: ComponentProps<"a">) => <a {...props} /> }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/lessons/video-player", () => ({ VideoPlayer: () => null }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { LessonInterface } from "@/components/lessons/lesson-interface";
import { AcademyRoadmap } from "@/components/academy/academy-roadmap";
import { StudentDashboard } from "@/components/dashboard/student-dashboard";
import { getCourseById, getLessonBySlug } from "@/lib/content";
import { getLessonProgressState } from "@/lib/learning-progress";
import { createClient } from "@/lib/supabase/client";

const lesson = getLessonBySlug("candles-foundation")!;
const props = { lesson, courseLessons: [lesson] };
let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  container.remove();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("lesson progress hydration", () => {
  it.each([
    { locale: "en", completed: false },
    { locale: "en", completed: true },
    { locale: "ar", completed: false },
    { locale: "ar", completed: true },
  ])("restores $locale notes and completion=$completed without replacing the server HTML", async ({ locale, completed }) => {
    testLocale.value = locale;
    const saved = {
      ...getLessonProgressState(lesson.id, lesson.courseId, lesson.slug),
      notes: "My retained course notes",
      videoPositionSeconds: 90,
      pdfReadProgress: 45,
      videoWatched: completed,
      pdfOpened: true,
      quizScore: completed ? 100 : null,
      quizCompleted: completed,
      lessonCompleted: completed,
    };
    // Server HTML has no browser storage; the returning learner does.
    container.innerHTML = renderToString(<LessonInterface {...props} />);
    window.localStorage.setItem("alpha-traders:lesson-progress", JSON.stringify({ [lesson.id]: saved }));
    const originalHeading = container.querySelector("h3");
    const recoverableErrors = vi.fn();
    await act(async () => {
      root = hydrateRoot(container, <LessonInterface {...props} />, { onRecoverableError: recoverableErrors });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(recoverableErrors).not.toHaveBeenCalled();
    expect(container.querySelector("h3")).toBe(originalHeading);
    expect(container.querySelector("textarea")?.value).toBe(saved.notes);
    expect(container.textContent).toContain(locale === "ar" ? "الفيديو 1:30 · القراءة 45%" : "Video 1:30 · Reading 45%");
    expect(container.textContent).toContain(`${locale === "ar" ? "تقدم الدورة" : "Course Progress"} ${completed ? 100 : 0}%`);
    expect(JSON.parse(window.localStorage.getItem("alpha-traders:lesson-progress")!)[lesson.id]).toEqual(saved);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(["en", "ar"])("hydrates the %s roadmap and restores its completed lesson", async (locale) => {
    testLocale.value = locale;
    const course = { ...getCourseById(lesson.courseId)!, lessons: [lesson] };
    const element = <AcademyRoadmap courses={[course]} />;
    container.innerHTML = renderToString(element);
    window.localStorage.setItem("alpha-traders:lesson-progress", JSON.stringify({
      [lesson.id]: { ...getLessonProgressState(lesson.id, lesson.courseId, lesson.slug), lessonCompleted: true },
    }));
    const recoverableErrors = vi.fn();
    await act(async () => { root = hydrateRoot(container, element, { onRecoverableError: recoverableErrors }); });
    expect(recoverableErrors).not.toHaveBeenCalled();
    expect(container.textContent).toContain("100%");
  });

  it.each(["en", "ar"])("hydrates the %s dashboard and restores its saved note", async (locale) => {
    testLocale.value = locale;
    container.innerHTML = renderToString(<StudentDashboard />);
    window.localStorage.setItem("alpha-traders:lesson-progress", JSON.stringify({
      [lesson.id]: { ...getLessonProgressState(lesson.id, lesson.courseId, lesson.slug), notes: "Retained dashboard note", lessonCompleted: true },
    }));
    const recoverableErrors = vi.fn();
    await act(async () => { root = hydrateRoot(container, <StudentDashboard />, { onRecoverableError: recoverableErrors }); });
    expect(recoverableErrors).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Retained dashboard note");
    expect(container.textContent).toContain("1/5");
  });
});
