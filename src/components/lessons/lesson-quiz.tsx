"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useLocale } from "next-intl";
import type { QuizQuestion } from "@/types/academy";
import { Button } from "@/components/ui/button";

export function LessonQuiz({
  questions,
  onCompleted,
}: {
  questions: QuizQuestion[];
  onCompleted: (scorePercent: number) => void;
}) {
  const locale = useLocale();
  const isAr = locale === "ar";
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);

  const scorePercent = useMemo(() => {
    if (!questions.length) return 0;
    const correct = questions.filter((q) => answers[q.id] === q.correctIndex).length;
    return Math.round((correct / questions.length) * 100);
  }, [answers, questions]);

  function submitQuiz() {
    setSubmitted(true);
    onCompleted(scorePercent);
  }

  function retryQuiz() {
    setAnswers({});
    setSubmitted(false);
  }

  return (
    <div className="space-y-5">
      {!questions.length ? (
        <p className="rounded-xl border border-white/10 p-4 text-sm text-[#9CA3AF]">
          {isAr ? "لا يوجد اختبار لهذا الدرس حالياً." : "No quiz is configured for this lesson yet."}
        </p>
      ) : null}
      {questions.map((question, index) => {
        const label = isAr ? question.questionAr : question.question;
        const options = isAr ? question.optionsAr : question.options;
        const explanation = isAr ? question.explanationAr : question.explanation;
        const selected = answers[question.id];
        const isCorrect = selected === question.correctIndex;

        return (
          <div key={question.id} className="space-y-3 rounded-xl border border-white/10 p-4">
            <p className="text-sm text-[#9CA3AF]">
              {isAr ? "سؤال" : "Question"} {index + 1}
            </p>
            <h4 className="text-base font-medium">{label}</h4>
            <div className="space-y-2">
              {options.map((option, optionIndex) => (
                <label key={`${question.id}-${optionIndex}`} className="flex items-center gap-2 rounded-lg border border-white/10 p-3 text-sm">
                  <input
                    type="radio"
                    name={question.id}
                    className="accent-[#C9A227]"
                    checked={selected === optionIndex}
                    disabled={submitted}
                    onChange={() => setAnswers((current) => ({ ...current, [question.id]: optionIndex }))}
                  />
                  {option}
                </label>
              ))}
            </div>
            {submitted && selected !== undefined ? (
              <p className={`text-sm ${isCorrect ? "text-emerald-300" : "text-amber-300"}`}>
                {isCorrect
                  ? isAr
                    ? "إجابة صحيحة."
                    : "Correct answer."
                  : isAr
                    ? "إجابة غير صحيحة."
                    : "Incorrect answer."}{" "}
                {explanation}
              </p>
            ) : null}
          </div>
        );
      })}

      {questions.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {!submitted ? (
            <Button onClick={submitQuiz}>{isAr ? "إرسال الاختبار" : "Submit Quiz"}</Button>
          ) : (
            <>
              <p className="text-sm text-[#C9A227]">
                {isAr ? "النتيجة" : "Score"}: {scorePercent}%
              </p>
              <Button variant="secondary" onClick={retryQuiz}>
                <RotateCcw className="h-4 w-4" />
                {isAr ? "إعادة المحاولة" : "Retry"}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
