import { describe, expect, it } from "vitest";
import {
  MAX_ACADEMY_NOTE_LENGTH,
  academyCourseProgressPercent,
  academyLessonProgressPercent,
  applyAcademyProgressPatch,
  emptyAcademyLessonProgress,
  gradeAcademyQuiz,
  latestAcademyProgress,
} from "../../apps/mobile/src/academy/academy-progress";

const requirements = {
  hasVideo: true,
  hasWorkbook: true,
  quizQuestionCount: 3,
  quizPassingScore: 70,
};

describe("native Academy progress", () => {
  it("requires every applicable lesson step and preserves the first completion time", () => {
    let progress = emptyAcademyLessonProgress("lesson-1", "course-1", "lesson-one", "2026-09-06T00:00:00.000Z");
    expect(academyLessonProgressPercent(progress, requirements)).toBe(0);

    progress = applyAcademyProgressPatch(progress, requirements, { videoWatched: true }, "2026-09-06T00:01:00.000Z");
    expect(academyLessonProgressPercent(progress, requirements)).toBe(33);
    expect(progress.lessonCompleted).toBe(false);

    progress = applyAcademyProgressPatch(progress, requirements, { workbookOpened: true }, "2026-09-06T00:02:00.000Z");
    expect(academyLessonProgressPercent(progress, requirements)).toBe(67);

    progress = applyAcademyProgressPatch(progress, requirements, { quizScore: 69 }, "2026-09-06T00:03:00.000Z");
    expect(progress.lessonCompleted).toBe(false);

    progress = applyAcademyProgressPatch(progress, requirements, { quizScore: 70 }, "2026-09-06T00:04:00.000Z");
    expect(academyLessonProgressPercent(progress, requirements)).toBe(100);
    expect(progress.lessonCompleted).toBe(true);
    expect(progress.completedAt).toBe("2026-09-06T00:04:00.000Z");

    progress = applyAcademyProgressPatch(progress, requirements, { bookmarked: true }, "2026-09-06T00:05:00.000Z");
    expect(progress.completedAt).toBe("2026-09-06T00:04:00.000Z");
  });

  it("ignores absent media requirements and bounds user-controlled values", () => {
    const base = emptyAcademyLessonProgress("lesson-1", "course-1", "lesson-one");
    const progress = applyAcademyProgressPatch(
      base,
      { hasVideo: false, hasWorkbook: false, quizQuestionCount: 1, quizPassingScore: 80 },
      { quizScore: 999, notes: "n".repeat(MAX_ACADEMY_NOTE_LENGTH + 100) },
    );
    expect(progress.quizScore).toBe(100);
    expect(progress.notes).toHaveLength(MAX_ACADEMY_NOTE_LENGTH);
    expect(progress.lessonCompleted).toBe(true);
    expect(academyLessonProgressPercent(progress, {
      hasVideo: false,
      hasWorkbook: false,
      quizQuestionCount: 1,
      quizPassingScore: 80,
    })).toBe(100);
  });

  it("derives stable course, resume, and quiz results", () => {
    const first = applyAcademyProgressPatch(
      emptyAcademyLessonProgress("lesson-1", "course-1", "one", "2026-09-06T00:00:00.000Z"),
      { hasVideo: true, hasWorkbook: false, quizQuestionCount: 0, quizPassingScore: 70 },
      { videoWatched: true, lastOpenedAt: "2026-09-06T01:00:00.000Z" },
      "2026-09-06T01:00:00.000Z",
    );
    const second = emptyAcademyLessonProgress("lesson-2", "course-1", "two", "2026-09-06T02:00:00.000Z");
    const map = { "lesson-1": first, "lesson-2": second };

    expect(academyCourseProgressPercent(["lesson-1", "lesson-2"], map)).toBe(50);
    expect(latestAcademyProgress(map)?.lessonId).toBe("lesson-2");
    expect(gradeAcademyQuiz(
      [{ id: "q1", correctIndex: 1 }, { id: "q2", correctIndex: 0 }, { id: "q3", correctIndex: 2 }],
      { q1: 1, q2: 1, q3: 2 },
    )).toBe(67);
  });
});
