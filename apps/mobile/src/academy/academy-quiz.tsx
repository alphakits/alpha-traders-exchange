import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MobileAcademyQuizQuestion, MobileLocale } from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { GoldButton } from "../components/gold-button";
import { academyText } from "./academy-copy";
import { gradeAcademyQuiz } from "./academy-progress";

export function AcademyQuiz({
  questions,
  passingScore,
  locale,
  onComplete,
}: {
  questions: MobileAcademyQuizQuestion[];
  passingScore: number;
  locale: MobileLocale;
  onComplete: (score: number) => Promise<void> | void;
}) {
  const isRTL = locale === "ar";
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [submittedScore, setSubmittedScore] = useState<number | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const hasEveryAnswer = questions.every((question) => selected[question.id] !== undefined);
  const passed = submittedScore !== null && submittedScore >= passingScore;

  const score = useMemo(() => {
    return gradeAcademyQuiz(questions, selected);
  }, [questions, selected]);

  async function submit() {
    if (!hasEveryAnswer) {
      setShowMissing(true);
      return;
    }
    setShowMissing(false);
    setSubmittedScore(score);
    setIsSaving(true);
    try {
      await onComplete(score);
    } finally {
      setIsSaving(false);
    }
  }

  function retry() {
    setSelected({});
    setSubmittedScore(null);
    setShowMissing(false);
  }

  return (
    <View style={styles.root}>
      <Text style={[styles.intro, isRTL && styles.rtlText]}>{academyText(locale, "quizBody")}</Text>
      {questions.map((question, questionIndex) => {
        const options = locale === "ar" ? question.optionsAr : question.options;
        return (
          <View key={question.id} style={styles.questionCard}>
            <Text style={[styles.questionNumber, isRTL && styles.rtlText]}>
              {academyText(locale, "question")} {questionIndex + 1}
            </Text>
            <Text style={[styles.question, isRTL && styles.rtlText]}>
              {locale === "ar" ? question.questionAr : question.question}
            </Text>
            <View accessibilityRole="radiogroup" style={styles.options}>
              {options.map((option, optionIndex) => {
                const isSelected = selected[question.id] === optionIndex;
                const isCorrect = submittedScore !== null && optionIndex === question.correctIndex;
                const isWrongSelection = submittedScore !== null && isSelected && !isCorrect;
                return (
                  <Pressable
                    key={`${question.id}-${optionIndex}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected, disabled: submittedScore !== null }}
                    disabled={submittedScore !== null}
                    onPress={() => setSelected((current) => ({ ...current, [question.id]: optionIndex }))}
                    style={({ pressed }) => [
                      styles.option,
                      isRTL && styles.rowReverse,
                      isSelected && styles.optionSelected,
                      isCorrect && styles.optionCorrect,
                      isWrongSelection && styles.optionWrong,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={[styles.radio, isSelected && styles.radioSelected]}>
                      {isSelected ? <View style={styles.radioDot} /> : null}
                    </View>
                    <Text style={[styles.optionText, isRTL && styles.rtlText]}>{option}</Text>
                  </Pressable>
                );
              })}
            </View>
            {submittedScore !== null ? (
              <View style={styles.feedback}>
                <Text style={[styles.feedbackTitle, isRTL && styles.rtlText]}>
                  {selected[question.id] === question.correctIndex
                    ? academyText(locale, "correctAnswer")
                    : academyText(locale, "incorrectAnswer")}
                </Text>
                <Text style={[styles.feedbackBody, isRTL && styles.rtlText]}>
                  {locale === "ar" ? question.explanationAr : question.explanation}
                </Text>
              </View>
            ) : null}
          </View>
        );
      })}
      {showMissing ? (
        <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>
          {academyText(locale, "selectEveryAnswer")}
        </Text>
      ) : null}
      {submittedScore === null ? (
        <GoldButton loading={isSaving} onPress={() => void submit()}>
          {academyText(locale, "submitQuiz")}
        </GoldButton>
      ) : (
        <View style={[styles.result, passed ? styles.resultPassed : styles.resultRetry]}>
          <Text accessibilityRole="header" style={[styles.resultScore, isRTL && styles.rtlText]}>
            {academyText(locale, "quizScore")}: {submittedScore}%
          </Text>
          <Text style={[styles.resultBody, isRTL && styles.rtlText]}>
            {passed ? academyText(locale, "quizPassed") : academyText(locale, "quizTryAgain")}
          </Text>
          {!passed ? (
            <GoldButton onPress={retry} variant="outline">
              {academyText(locale, "retryQuiz")}
            </GoldButton>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.lg },
  intro: { color: colors.textMuted, fontSize: typography.body, lineHeight: 24 },
  questionCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  questionNumber: { color: colors.goldBright, fontSize: typography.caption, fontWeight: "900" },
  question: { color: colors.text, fontSize: typography.body, fontWeight: "800", lineHeight: 24 },
  options: { gap: spacing.sm },
  option: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 54,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionSelected: { borderColor: colors.gold },
  optionCorrect: { backgroundColor: "rgba(50, 196, 141, 0.10)", borderColor: colors.success },
  optionWrong: { backgroundColor: "rgba(240, 106, 106, 0.10)", borderColor: colors.danger },
  radio: {
    alignItems: "center",
    borderColor: colors.textMuted,
    borderRadius: 12,
    borderWidth: 2,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  radioSelected: { borderColor: colors.gold },
  radioDot: { backgroundColor: colors.gold, borderRadius: 6, height: 12, width: 12 },
  optionText: { color: colors.text, flex: 1, fontSize: typography.body, lineHeight: 23 },
  feedback: { gap: spacing.xs },
  feedbackTitle: { color: colors.goldBright, fontSize: typography.small, fontWeight: "900" },
  feedbackBody: { color: colors.textMuted, fontSize: typography.small, lineHeight: 21 },
  error: { color: colors.danger, fontSize: typography.small, lineHeight: 20 },
  result: { borderRadius: radius.md, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  resultPassed: { backgroundColor: "rgba(50, 196, 141, 0.08)", borderColor: colors.success },
  resultRetry: { backgroundColor: "rgba(231, 184, 75, 0.08)", borderColor: colors.warning },
  resultScore: { color: colors.text, fontSize: typography.section, fontWeight: "900" },
  resultBody: { color: colors.textMuted, fontSize: typography.body, lineHeight: 23 },
  pressed: { opacity: 0.72 },
  rowReverse: { flexDirection: "row-reverse" },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
});
