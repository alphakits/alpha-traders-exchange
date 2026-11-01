"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { useLocale } from "next-intl";
import type { QuizQuestion } from "@/types/academy";
import { Button } from "@/components/ui/button";
import styles from "@/components/academy/academy-experience.module.css";

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
  const answeredCount = questions.filter(question => answers[question.id] !== undefined).length;

  const scorePercent = useMemo(() => {
    if (!questions.length) return 0;
    const correct = questions.filter((q) => answers[q.id] === q.correctIndex).length;
    return Math.round((correct / questions.length) * 100);
  }, [answers, questions]);

  function submitQuiz() {
    if (answeredCount !== questions.length || submitted) return;
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
          <fieldset key={question.id} className="space-y-3 rounded-xl border border-white/10 p-4">
            <p className="text-sm text-[#9CA3AF]">
              {isAr ? "سؤال" : "Question"} {index + 1}
            </p>
            <legend className="px-1 text-base font-medium">{label}</legend>
            <div className="space-y-2">
              {options.map((option, optionIndex) => (
                <label key={`${question.id}-${optionIndex}`} data-selected={selected === optionIndex} data-correct={submitted && optionIndex === question.correctIndex} className={`flex items-center gap-2 rounded-lg border border-white/10 p-3 text-sm ${styles.quizOption}`}>
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
          </fieldset>
        );
      })}

      {questions.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {!submitted ? (
            <><p className="w-full text-xs text-[#9CA3AF]" role="status">{answeredCount} / {questions.length} {isAr ? "إجابات · أجب عن كل الأسئلة ثم أرسل الاختبار" : "answered · Answer every question, then submit"}</p><Button onClick={submitQuiz} disabled={answeredCount !== questions.length}>{isAr ? "إرسال الاختبار" : "Submit Quiz"}</Button></>
          ) : (
            <>
              <p className={styles.quizResult} role="status"><span aria-hidden="true">{scorePercent >= 70 ? "🎯" : "💡"}</span>{" "}
                {isAr ? "النتيجة" : "Score"}: {scorePercent}%
                <span className="block">{scorePercent >= 70 ? (isAr ? "أحسنت! اجتزت الاختبار." : "Nice work. You passed this check!") : (isAr ? "راجع الشرح وجرّب مرة أخرى. تحتاج إلى 70٪ للاجتياز." : "Review the explanations and try again. You need 70% to pass.")}</span>
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
