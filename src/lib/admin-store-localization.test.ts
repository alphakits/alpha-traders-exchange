import { describe, expect, it } from "vitest";

import { validateLessonPayload } from "@/lib/admin-store";
import type { Lesson } from "@/types/academy";

function lessonFixture(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: "lesson-localization-test",
    courseId: "c1",
    module: "Basics",
    moduleAr: "الأساسيات",
    slug: "lesson-localization-test",
    title: "Market basics",
    titleAr: "أساسيات السوق",
    description: "Learn the market basics.",
    descriptionAr: "تعلّم أساسيات السوق.",
    summary: "A short market introduction.",
    summaryAr: "مقدمة قصيرة عن السوق.",
    objectives: [],
    objectivesAr: [],
    takeaways: [],
    takeawaysAr: [],
    keywords: [],
    keywordsAr: [],
    durationMinutes: 20,
    order: 1,
    status: "published",
    tags: [],
    tagsAr: [],
    assets: {
      videoProvider: "self-hosted",
      videoUrl: "",
      videoChapters: [],
      pdfProvider: "google-drive",
      pdfFileId: "",
      pdfUrl: "",
      presentationUrl: "",
      notes: "",
      notesAr: "",
      resources: [],
    },
    quiz: [],
    ...overrides,
  };
}

describe("admin lesson bilingual publishing", () => {
  it("allows an incomplete bilingual draft to be saved", () => {
    const draft = lessonFixture({
      status: "draft",
      titleAr: "",
      description: "",
      descriptionAr: "",
      summary: "",
      summaryAr: "",
    });

    expect(() => validateLessonPayload(draft, [], "create")).not.toThrow();
  });

  it("blocks publishing when an Arabic lesson field is missing", () => {
    const lesson = lessonFixture({ descriptionAr: "" });

    expect(() => validateLessonPayload(lesson, [], "update")).toThrow("Arabic lesson description is required before publishing.");
  });

  it("blocks publishing when a quiz is not complete in both languages", () => {
    const lesson = lessonFixture({
      quiz: [{
        id: "q1",
        type: "multiple-choice",
        question: "What is USDT?",
        questionAr: "ما هي USDT؟",
        options: ["A stablecoin", "A bank"],
        optionsAr: ["عملة مستقرة", ""],
        correctIndex: 0,
        explanation: "USDT is a stablecoin.",
        explanationAr: "USDT عملة مستقرة.",
      }],
    });

    expect(() => validateLessonPayload(lesson, [], "update")).toThrow("matching Arabic options");
  });

  it("allows publishing when lesson and quiz content are complete in English and Arabic", () => {
    const lesson = lessonFixture({
      quiz: [{
        id: "q1",
        type: "true-false",
        question: "USDT is a stablecoin.",
        questionAr: "USDT عملة مستقرة.",
        options: ["True", "False"],
        optionsAr: ["صحيح", "خطأ"],
        correctIndex: 0,
        explanation: "It tracks the US dollar.",
        explanationAr: "تتبع قيمة الدولار الأمريكي.",
      }],
    });

    expect(() => validateLessonPayload(lesson, [], "update")).not.toThrow();
  });
});
