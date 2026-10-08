import { describe, expect, it } from "vitest";
import { getAcademyJourney } from "./academy-journey";
import { createDefaultLessonProgress } from "./learning-progress";
import { lessons } from "./content";

describe("student learning journey", () => {
  it("starts a new student at the first published lesson", () => {
    expect(getAcademyJourney(lessons, [], null)).toMatchObject({ nextLesson: lessons[0], completed: 0, percent: 0, allComplete: false });
  });
  it("continues the last unfinished lesson", () => {
    expect(getAcademyJourney(lessons, [], lessons[2].id).nextLesson).toEqual(lessons[2]);
  });
  it("moves forward after completion and ignores stale or foreign course records", () => {
    const first = { ...createDefaultLessonProgress(lessons[0].id, lessons[0].courseId, lessons[0].slug), lessonCompleted: true };
    const wrongCourse = { ...first, lessonId: lessons[1].id, courseId: "other-course" };
    const removedLesson = { ...first, lessonId: "unpublished" };
    expect(getAcademyJourney(lessons, [first, wrongCourse, removedLesson], lessons[0].id)).toMatchObject({ nextLesson: lessons[1], completed: 1, percent: 20 });
  });
  it("offers review after the entire published path is completed", () => {
    const all = lessons.map(lesson => ({ ...createDefaultLessonProgress(lesson.id, lesson.courseId, lesson.slug), lessonCompleted: true }));
    expect(getAcademyJourney(lessons, all, lessons.at(-1)!.id)).toMatchObject({ nextLesson: lessons[0], completed: lessons.length, percent: 100, allComplete: true });
  });
  it("handles an empty catalog without claiming completion", () => {
    expect(getAcademyJourney([], [], null)).toMatchObject({ nextLesson: null, completed: 0, percent: 0, allComplete: false });
  });
});
