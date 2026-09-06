import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import type { MobileAcademyLessonSummary } from "@alpha-traders/contracts";
import { useAuth } from "../auth/auth-context";
import { GoldButton } from "../components/gold-button";
import { useLocale } from "../i18n/locale-context";
import { useAcademyLesson } from "../academy/use-academy";
import { useAcademyProgress } from "../academy/academy-progress-context";
import {
  academyCourseProgressPercent,
  academyLessonProgressPercent,
  emptyAcademyLessonProgress,
} from "../academy/academy-progress";
import { AcademyQuiz } from "../academy/academy-quiz";
import { academyDifficultyLabel, academyText } from "../academy/academy-copy";
import { isSafeAcademyUrl } from "../academy/academy-links";
import {
  AcademyBackButton,
  AcademyBulletList,
  AcademyProgressBar,
  AcademySection,
  academySharedStyles,
} from "../academy/academy-ui";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function lessonTitle(lesson: MobileAcademyLessonSummary, locale: "ar" | "en") {
  return locale === "ar" ? lesson.titleAr : lesson.title;
}

function MetaPill({ children }: { children: string }) {
  return (
    <View style={styles.metaPill}>
      <Text style={styles.metaText}>{children}</Text>
    </View>
  );
}

function RequirementRow({ complete, label, isRTL }: { complete: boolean; label: string; isRTL: boolean }) {
  return (
    <View style={[styles.requirementRow, isRTL && academySharedStyles.rowReverse]}>
      <View style={[styles.requirementIcon, complete && styles.requirementIconComplete]}>
        <Text style={[styles.requirementCheck, complete && styles.requirementCheckComplete]}>{complete ? "✓" : "·"}</Text>
      </View>
      <Text style={[styles.requirementLabel, complete && styles.requirementLabelComplete, isRTL && academySharedStyles.rtlText]}>
        {label}
      </Text>
    </View>
  );
}

export function AcademyLessonScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = firstParam(params.slug);
  const { status, user } = useAuth();
  const { locale, isRTL } = useLocale();
  const query = useAcademyLesson(slug);
  const academyProgress = useAcademyProgress();
  const lesson = query.data?.lesson;
  const openedLessonRef = useRef<string | null>(null);
  const notesLessonRef = useRef<string | null>(null);
  const notesSaveRef = useRef(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaved, setNotesSaved] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  const progressRecord = useMemo(() => {
    if (!lesson) return null;
    return academyProgress.progress[lesson.id]
      ?? emptyAcademyLessonProgress(lesson.id, lesson.courseId, lesson.slug, "1970-01-01T00:00:00.000Z");
  }, [academyProgress.progress, lesson]);

  useEffect(() => {
    if (!lesson || !academyProgress.isReady || openedLessonRef.current === lesson.id) return;
    openedLessonRef.current = lesson.id;
    void academyProgress.updateLesson(lesson, { lastOpenedAt: new Date().toISOString() });
  }, [academyProgress, lesson]);

  useEffect(() => {
    if (!lesson || !progressRecord || !academyProgress.isReady || notesLessonRef.current === lesson.id) return;
    notesLessonRef.current = lesson.id;
    setNotesDraft(progressRecord.notes);
    setNotesSaved(false);
  }, [academyProgress.isReady, lesson, progressRecord]);

  if (status !== "authenticated" || !user) return <Redirect href="/(public)/login" />;

  function backToTrack() {
    if (router.canGoBack()) router.back();
    else if (query.data?.course.slug) {
      router.replace({ pathname: "/academy/[courseSlug]", params: { courseSlug: query.data.course.slug } });
    } else {
      router.replace("/(tabs)/academy");
    }
  }

  async function openExternal(url: string, onOpened?: () => Promise<unknown> | unknown) {
    if (!isSafeAcademyUrl(url)) {
      Alert.alert(academyText(locale, "linkError"));
      return;
    }
    try {
      await Linking.openURL(url);
      await onOpened?.();
    } catch {
      Alert.alert(academyText(locale, "linkError"));
    }
  }

  async function saveNotes() {
    if (!lesson || notesSaveRef.current || notesDraft === progressRecord?.notes) return;
    notesSaveRef.current = true;
    setSavingNotes(true);
    setNotesSaved(false);
    try {
      await academyProgress.updateLesson(lesson, { notes: notesDraft });
      setNotesSaved(true);
    } finally {
      notesSaveRef.current = false;
      setSavingNotes(false);
    }
  }

  function openAdjacent(next: MobileAcademyLessonSummary | null) {
    if (!next) return;
    router.replace({ pathname: "/lesson/[slug]", params: { slug: next.slug } });
  }

  if (query.isLoading || !academyProgress.isReady) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel={academyText(locale, "lesson")} color={colors.gold} size="large" />
      </View>
    );
  }

  if (query.isError || !lesson || !progressRecord || !query.data) {
    return (
      <View style={styles.centeredContent}>
        <AcademyBackButton label={academyText(locale, "backToAcademy")} isRTL={isRTL} onPress={backToTrack} />
        <Text accessibilityRole="alert" style={[styles.errorTitle, isRTL && academySharedStyles.rtlText]}>
          {academyText(locale, query.isError ? "loadError" : "contentUnavailable")}
        </Text>
        <GoldButton onPress={() => void query.refetch()} variant="outline">
          {locale === "ar" ? "حاول مجددًا" : "Try again"}
        </GoldButton>
      </View>
    );
  }

  const completionPercent = academyLessonProgressPercent(progressRecord, lesson);
  const courseProgress = academyCourseProgressPercent(
    query.data.course.lessons.map((entry) => entry.id),
    academyProgress.progress,
  );
  const videoComplete = !lesson.hasVideo || progressRecord.videoWatched;
  const workbookComplete = !lesson.hasWorkbook || progressRecord.workbookOpened;
  const quizComplete = lesson.quizQuestionCount === 0
    || (progressRecord.quizScore !== null && progressRecord.quizScore >= lesson.quizPassingScore);

  return (
    <ScrollView
      style={academySharedStyles.screen}
      contentContainerStyle={academySharedStyles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.gold} />}
      showsVerticalScrollIndicator={false}
    >
      <AcademyBackButton label={academyText(locale, "backToTrack")} isRTL={isRTL} onPress={backToTrack} />

      <View style={styles.hero}>
        <Text style={[academySharedStyles.eyebrow, isRTL && academySharedStyles.rtlText]}>
          {locale === "ar" ? lesson.moduleAr : lesson.module}
        </Text>
        <Text accessibilityRole="header" style={[academySharedStyles.title, isRTL && academySharedStyles.rtlText]}>
          {lessonTitle(lesson, locale)}
        </Text>
        <Text style={[academySharedStyles.subtitle, isRTL && academySharedStyles.rtlText]}>
          {locale === "ar" ? lesson.descriptionAr : lesson.description}
        </Text>
        <View style={[styles.metaRow, isRTL && academySharedStyles.rowReverse]}>
          <MetaPill>{`${academyText(locale, "lesson")} ${lesson.lessonNumber}`}</MetaPill>
          <MetaPill>{`${lesson.durationMinutes} ${academyText(locale, "minutes")}`}</MetaPill>
          <MetaPill>{academyDifficultyLabel(lesson.difficulty, locale)}</MetaPill>
        </View>
      </View>

      <AcademySection title={academyText(locale, "lessonProgress")} isRTL={isRTL}>
        <AcademyProgressBar value={completionPercent} label={academyText(locale, "lessonProgress")} />
        <Text style={[styles.completionBody, isRTL && academySharedStyles.rtlText]}>
          {progressRecord.lessonCompleted
            ? academyText(locale, "completionReady")
            : academyText(locale, "completionPending")}
        </Text>
        {lesson.hasVideo ? <RequirementRow complete={videoComplete} label={academyText(locale, videoComplete ? "videoCompleted" : "lessonVideo")} isRTL={isRTL} /> : null}
        {lesson.hasWorkbook ? <RequirementRow complete={workbookComplete} label={academyText(locale, workbookComplete ? "workbookOpened" : "workbook")} isRTL={isRTL} /> : null}
        {lesson.quizQuestionCount > 0 ? (
          <RequirementRow
            complete={quizComplete}
            label={progressRecord.quizScore === null
              ? academyText(locale, "quiz")
              : `${academyText(locale, "quizScore")}: ${progressRecord.quizScore}%`}
            isRTL={isRTL}
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: progressRecord.bookmarked }}
          onPress={() => void academyProgress.updateLesson(lesson, { bookmarked: !progressRecord.bookmarked })}
          style={({ pressed }) => [styles.bookmarkButton, pressed && academySharedStyles.pressed]}
        >
          <Text style={styles.bookmarkText}>
            {progressRecord.bookmarked ? "★" : "☆"} {academyText(locale, progressRecord.bookmarked ? "bookmarked" : "bookmark")}
          </Text>
        </Pressable>
      </AcademySection>

      {lesson.narrative?.intro ? (
        <AcademySection title={academyText(locale, "overview")} isRTL={isRTL}>
          <Text style={[academySharedStyles.body, isRTL && academySharedStyles.rtlText]}>
            {locale === "ar" ? lesson.narrative.introAr : lesson.narrative.intro}
          </Text>
        </AcademySection>
      ) : null}

      {lesson.hasVideo ? (
        <AcademySection title={academyText(locale, "lessonVideo")} isRTL={isRTL}>
          <Text style={[academySharedStyles.body, isRTL && academySharedStyles.rtlText]}>
            {locale === "ar" ? lesson.descriptionAr : lesson.description}
          </Text>
          <GoldButton onPress={() => void openExternal(lesson.videoUrl)}>
            {academyText(locale, "openVideo")}
          </GoldButton>
          {!progressRecord.videoWatched ? (
            <GoldButton
              onPress={() => void academyProgress.updateLesson(lesson, { videoWatched: true })}
              variant="outline"
            >
              {academyText(locale, "markVideoWatched")}
            </GoldButton>
          ) : null}
          {lesson.videoChapters.length ? (
            <View style={styles.chapterList}>
              {lesson.videoChapters.map((chapter) => (
                <View key={chapter.id} style={[styles.chapterRow, isRTL && academySharedStyles.rowReverse]}>
                  <Text style={styles.chapterTime}>
                    {Math.floor(chapter.timeSeconds / 60)}:{String(chapter.timeSeconds % 60).padStart(2, "0")}
                  </Text>
                  <Text style={[styles.chapterTitle, isRTL && academySharedStyles.rtlText]}>
                    {locale === "ar" ? chapter.titleAr : chapter.title}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </AcademySection>
      ) : null}

      <AcademySection title={academyText(locale, "lessonSummary")} isRTL={isRTL}>
        <Text style={[academySharedStyles.body, isRTL && academySharedStyles.rtlText]}>
          {locale === "ar" ? lesson.summaryAr : lesson.summary}
        </Text>
      </AcademySection>

      <AcademySection title={academyText(locale, "keyTakeaways")} isRTL={isRTL}>
        <AcademyBulletList items={locale === "ar" ? lesson.takeawaysAr : lesson.takeaways} isRTL={isRTL} />
      </AcademySection>

      {lesson.narrative?.keyConcepts.length ? (
        <AcademySection title={academyText(locale, "keyConcepts")} isRTL={isRTL}>
          <AcademyBulletList items={locale === "ar" ? lesson.narrative.keyConceptsAr : lesson.narrative.keyConcepts} isRTL={isRTL} />
        </AcademySection>
      ) : null}

      <AcademySection title={academyText(locale, "objectives")} isRTL={isRTL}>
        <AcademyBulletList items={locale === "ar" ? lesson.objectivesAr : lesson.objectives} isRTL={isRTL} />
      </AcademySection>

      {lesson.hasWorkbook ? (
        <AcademySection title={academyText(locale, "workbook")} isRTL={isRTL}>
          {lesson.narrative?.workbookIntro ? (
            <Text style={[academySharedStyles.body, isRTL && academySharedStyles.rtlText]}>
              {locale === "ar" ? lesson.narrative.workbookIntroAr : lesson.narrative.workbookIntro}
            </Text>
          ) : null}
          <GoldButton onPress={() => void openExternal(
            lesson.workbookUrl,
            () => academyProgress.updateLesson(lesson, { workbookOpened: true }),
          )}>
            {progressRecord.workbookOpened
              ? academyText(locale, "workbookOpened")
              : academyText(locale, "openWorkbook")}
          </GoldButton>
          {lesson.presentationUrl ? (
            <GoldButton onPress={() => void openExternal(lesson.presentationUrl)} variant="outline">
              {academyText(locale, "openPresentation")}
            </GoldButton>
          ) : null}
        </AcademySection>
      ) : null}

      {lesson.resources.length ? (
        <AcademySection title={academyText(locale, "resources")} isRTL={isRTL}>
          {lesson.resources.map((resource) => (
            <Pressable
              key={resource.id}
              accessibilityRole="link"
              onPress={() => void openExternal(resource.url)}
              style={({ pressed }) => [styles.resourceButton, isRTL && academySharedStyles.rowReverse, pressed && academySharedStyles.pressed]}
            >
              <Text style={[styles.resourceLabel, isRTL && academySharedStyles.rtlText]}>
                {locale === "ar" ? resource.labelAr : resource.label}
              </Text>
              <Text style={styles.resourceArrow}>{isRTL ? "‹" : "›"}</Text>
            </Pressable>
          ))}
        </AcademySection>
      ) : null}

      {lesson.notes || lesson.notesAr ? (
        <AcademySection title={academyText(locale, "courseNotes")} isRTL={isRTL}>
          <Text style={[academySharedStyles.body, isRTL && academySharedStyles.rtlText]}>
            {locale === "ar" ? lesson.notesAr : lesson.notes}
          </Text>
        </AcademySection>
      ) : null}

      {lesson.narrative?.visuals.length ? (
        <AcademySection title={academyText(locale, "chartsExamples")} isRTL={isRTL}>
          {lesson.narrative.visuals.map((visual) => (
            <View key={visual.url} style={styles.visualCard}>
              <Image
                accessibilityLabel={locale === "ar" ? visual.titleAr : visual.title}
                alt={locale === "ar" ? visual.titleAr : visual.title}
                resizeMode="contain"
                source={{ uri: visual.url }}
                style={styles.visualImage}
              />
              <Text style={[styles.visualCaption, isRTL && academySharedStyles.rtlText]}>
                {locale === "ar" ? visual.titleAr : visual.title}
              </Text>
            </View>
          ))}
        </AcademySection>
      ) : null}

      {lesson.narrative?.practicalExamples.length ? (
        <AcademySection title={academyText(locale, "practicalExamples")} isRTL={isRTL}>
          <AcademyBulletList
            items={locale === "ar" ? lesson.narrative.practicalExamplesAr : lesson.narrative.practicalExamples}
            isRTL={isRTL}
          />
        </AcademySection>
      ) : null}

      {lesson.narrative?.beginnerMistakes.length ? (
        <AcademySection title={academyText(locale, "commonMistakes")} isRTL={isRTL}>
          <AcademyBulletList
            items={locale === "ar" ? lesson.narrative.beginnerMistakesAr : lesson.narrative.beginnerMistakes}
            isRTL={isRTL}
          />
        </AcademySection>
      ) : null}

      <AcademySection title={academyText(locale, "personalNotes")} isRTL={isRTL}>
        <Text style={[styles.notesHint, isRTL && academySharedStyles.rtlText]}>
          {academyText(locale, "personalNotesBody")}
        </Text>
        <TextInput
          accessibilityLabel={academyText(locale, "personalNotes")}
          maxLength={2_000}
          multiline
          onChangeText={(value) => {
            setNotesDraft(value);
            setNotesSaved(false);
          }}
          onBlur={() => {
            if (notesDraft !== progressRecord.notes) void saveNotes();
          }}
          placeholder={academyText(locale, "notesPlaceholder")}
          placeholderTextColor={colors.textMuted}
          style={[styles.notesInput, isRTL && academySharedStyles.rtlText]}
          textAlignVertical="top"
          value={notesDraft}
        />
        <GoldButton disabled={notesDraft === progressRecord.notes} loading={savingNotes} onPress={() => void saveNotes()} variant="outline">
          {notesSaved ? academyText(locale, "notesSaved") : academyText(locale, "saveNotes")}
        </GoldButton>
      </AcademySection>

      {lesson.quiz.length ? (
        <AcademySection title={academyText(locale, "quiz")} isRTL={isRTL}>
          {lesson.narrative?.quizContext ? (
            <Text style={[academySharedStyles.body, isRTL && academySharedStyles.rtlText]}>
              {locale === "ar" ? lesson.narrative.quizContextAr : lesson.narrative.quizContext}
            </Text>
          ) : null}
          <AcademyQuiz
            key={lesson.id}
            questions={lesson.quiz}
            passingScore={lesson.quizPassingScore}
            locale={locale}
            onComplete={async (score) => {
              await academyProgress.updateLesson(lesson, { quizScore: score });
            }}
          />
        </AcademySection>
      ) : null}

      <AcademySection title={academyText(locale, "courseProgress")} isRTL={isRTL}>
        <AcademyProgressBar value={courseProgress} label={academyText(locale, "courseProgress")} />
        <View style={styles.navigationButtons}>
          {query.data.previousLesson ? (
            <GoldButton onPress={() => openAdjacent(query.data.previousLesson)} variant="outline">
              {academyText(locale, "previousLesson")}
            </GoldButton>
          ) : null}
          {query.data.nextLesson ? (
            <GoldButton onPress={() => openAdjacent(query.data.nextLesson)}>
              {academyText(locale, "nextLesson")}
            </GoldButton>
          ) : null}
        </View>
      </AcademySection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: "center", backgroundColor: colors.background, flex: 1, justifyContent: "center" },
  centeredContent: {
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.xl,
    justifyContent: "center",
    padding: spacing.xl,
  },
  errorTitle: { color: colors.text, fontSize: typography.section, fontWeight: "900", textAlign: "center" },
  hero: { gap: spacing.md, paddingVertical: spacing.md },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metaPill: {
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  metaText: { color: colors.textMuted, fontSize: typography.small, fontWeight: "700" },
  completionBody: { color: colors.textMuted, fontSize: typography.small, lineHeight: 21 },
  requirementRow: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  requirementIcon: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  requirementIconComplete: { backgroundColor: "rgba(50, 196, 141, 0.12)", borderColor: colors.success },
  requirementCheck: { color: colors.textMuted, fontSize: typography.body, fontWeight: "900" },
  requirementCheckComplete: { color: colors.success },
  requirementLabel: { color: colors.textMuted, flex: 1, fontSize: typography.body, lineHeight: 23 },
  requirementLabelComplete: { color: colors.text },
  bookmarkButton: {
    alignItems: "center",
    borderColor: colors.borderGold,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  bookmarkText: { color: colors.goldBright, fontSize: typography.body, fontWeight: "800" },
  chapterList: { gap: spacing.sm },
  chapterRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 48,
    padding: spacing.md,
  },
  chapterTime: { color: colors.goldBright, fontSize: typography.small, fontVariant: ["tabular-nums"], fontWeight: "900" },
  chapterTitle: { color: colors.text, flex: 1, fontSize: typography.small, lineHeight: 20 },
  resourceButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 54,
    paddingHorizontal: spacing.md,
  },
  resourceLabel: { color: colors.text, flex: 1, fontSize: typography.body, fontWeight: "700", lineHeight: 23 },
  resourceArrow: { color: colors.goldBright, fontSize: 24, fontWeight: "900" },
  visualCard: { backgroundColor: colors.surfaceRaised, borderRadius: radius.md, overflow: "hidden" },
  visualImage: { backgroundColor: colors.background, height: 230, width: "100%" },
  visualCaption: { color: colors.text, fontSize: typography.small, fontWeight: "700", lineHeight: 20, padding: spacing.md },
  notesHint: { color: colors.textMuted, fontSize: typography.small, lineHeight: 21 },
  notesInput: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 24,
    minHeight: 140,
    padding: spacing.md,
  },
  navigationButtons: { gap: spacing.md },
});
