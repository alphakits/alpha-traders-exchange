import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LessonQuiz } from "./lesson-quiz";
import { getLessonBySlug } from "@/lib/content";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));
afterEach(cleanup);

describe("lesson quiz completion", () => {
  it("requires answers, records an actual score, and allows a clean retry", () => {
    const questions = getLessonBySlug("candles-foundation")!.quiz;
    const onCompleted = vi.fn();
    render(<LessonQuiz questions={questions} onCompleted={onCompleted} />);
    expect((screen.getByRole("button", { name: "Submit Quiz" }) as HTMLButtonElement).disabled).toBe(true);
    questions.forEach(question => fireEvent.click(screen.getByLabelText(question.options[(question.correctIndex + 1) % question.options.length], { selector: `input[name="${question.id}"]` })));
    fireEvent.click(screen.getByRole("button", { name: "Submit Quiz" }));
    expect(onCompleted).toHaveBeenLastCalledWith(0);
    expect(screen.getByRole("status").textContent).toContain("70% to pass");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getAllByRole("radio").every(radio => !(radio as HTMLInputElement).checked)).toBe(true);
    questions.forEach(question => fireEvent.click(screen.getByLabelText(question.options[question.correctIndex], { selector: `input[name="${question.id}"]` })));
    fireEvent.click(screen.getByRole("button", { name: "Submit Quiz" }));
    expect(onCompleted).toHaveBeenLastCalledWith(100);
    expect(screen.getByRole("status").textContent).toContain("You passed");
  });
});
