import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultLessonProgress, getCourseProgressPercent, isCourseComplete } from "./learning-progress";

const key = "alpha-traders:lesson-progress";
const record = (id: string, completed: boolean, courseId = "course") => ({ ...createDefaultLessonProgress(id, courseId, id), lessonCompleted: completed });
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("course completion eligibility", () => {
  it("requires every lesson from this course, not simply the final lesson", () => {
    localStorage.setItem(key, JSON.stringify({ first: record("first", false), last: record("last", true) }));
    expect(isCourseComplete("course", ["first", "last"])).toBe(false);
    expect(getCourseProgressPercent("course", ["first", "last"])).toBe(50);
    localStorage.setItem(key, JSON.stringify({ first: record("first", true), last: record("last", true) }));
    expect(isCourseComplete("course", ["first", "last"])).toBe(true);
    expect(isCourseComplete("another-course", ["first", "last"])).toBe(false);
    expect(getCourseProgressPercent("another-course", ["first", "last"])).toBe(0);
    expect(isCourseComplete("course", [])).toBe(false);
  });
  it("does not treat a rounded 100 percent as completion", () => {
    const ids = Array.from({ length: 201 }, (_, i) => String(i));
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(ids.map((id, i) => [id, record(id, i !== 0)]))));
    expect(getCourseProgressPercent("course", ids)).toBe(100);
    expect(isCourseComplete("course", ids)).toBe(false);
  });
  it.each(["null", "[]", "{", '{"first":{"lessonCompleted":"true","courseId":"course"}}'])("ignores malformed saved completion: %s", raw => {
    localStorage.setItem(key, raw);
    expect(isCourseComplete("course", ["first"])).toBe(false);
  });
  it("does not show completion when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(isCourseComplete("course", ["first"])).toBe(false);
  });
});
