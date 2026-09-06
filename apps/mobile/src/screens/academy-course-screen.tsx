import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { useAuth } from "../auth/auth-context";
import { GoldButton } from "../components/gold-button";
import { useLocale } from "../i18n/locale-context";
import { useAcademyCatalog } from "../academy/use-academy";
import { useAcademyProgress } from "../academy/academy-progress-context";
import { academyCourseProgressPercent } from "../academy/academy-progress";
import { academyDifficultyLabel, academyLevelLabel, academyText } from "../academy/academy-copy";
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

export function AcademyCourseScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ courseSlug?: string | string[] }>();
  const courseSlug = firstParam(params.courseSlug);
  const { status, user } = useAuth();
  const { locale, isRTL } = useLocale();
  const query = useAcademyCatalog();
  const academyProgress = useAcademyProgress();
  const course = query.data?.courses.find((item) => item.slug === courseSlug);

  if (status !== "authenticated" || !user) return <Redirect href="/(public)/login" />;

  function backToAcademy() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/academy");
  }

  if (query.isLoading || !academyProgress.isReady) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator accessibilityLabel={academyText(locale, "trackOverview")} color={colors.gold} size="large" />
      </View>
    );
  }

  if (query.isError || !course) {
    return (
      <View style={styles.centeredContent}>
        <AcademyBackButton label={academyText(locale, "backToAcademy")} isRTL={isRTL} onPress={backToAcademy} />
        <Text accessibilityRole="alert" style={[styles.errorTitle, isRTL && academySharedStyles.rtlText]}>
          {academyText(locale, query.isError ? "loadError" : "contentUnavailable")}
        </Text>
        <GoldButton onPress={() => void query.refetch()} variant="outline">
          {locale === "ar" ? "حاول مجددًا" : "Try again"}
        </GoldButton>
      </View>
    );
  }

  const progress = academyCourseProgressPercent(
    course.lessons.map((lesson) => lesson.id),
    academyProgress.progress,
  );

  return (
    <ScrollView
      style={academySharedStyles.screen}
      contentContainerStyle={academySharedStyles.content}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={colors.gold} />}
      showsVerticalScrollIndicator={false}
    >
      <AcademyBackButton label={academyText(locale, "backToAcademy")} isRTL={isRTL} onPress={backToAcademy} />
      <View style={styles.hero}>
        <Text style={[academySharedStyles.eyebrow, isRTL && academySharedStyles.rtlText]}>
          {academyLevelLabel(course.level, locale)}
        </Text>
        <Text accessibilityRole="header" style={[academySharedStyles.title, isRTL && academySharedStyles.rtlText]}>
          {locale === "ar" ? course.titleAr : course.title}
        </Text>
        <Text style={[academySharedStyles.subtitle, isRTL && academySharedStyles.rtlText]}>
          {locale === "ar" ? course.summaryAr : course.summary}
        </Text>
        <AcademyProgressBar value={progress} label={academyText(locale, "courseProgress")} />
      </View>

      {course.learningPoints.length ? (
        <AcademySection title={academyText(locale, "whatYouLearn")} isRTL={isRTL}>
          <AcademyBulletList items={locale === "ar" ? course.learningPointsAr : course.learningPoints} isRTL={isRTL} />
        </AcademySection>
      ) : null}

      {course.whyStart ? (
        <AcademySection title={academyText(locale, "whyStart")} isRTL={isRTL}>
          <Text style={[academySharedStyles.body, isRTL && academySharedStyles.rtlText]}>
            {locale === "ar" ? course.whyStartAr : course.whyStart}
          </Text>
        </AcademySection>
      ) : null}

      <View style={styles.lessonsBlock}>
        <Text accessibilityRole="header" style={[styles.lessonsTitle, isRTL && academySharedStyles.rtlText]}>
          {academyText(locale, "publishedLessons")}
        </Text>
        {course.lessons.map((lesson) => {
          const lessonProgress = academyProgress.progress[lesson.id];
          const statusLabel = lessonProgress?.lessonCompleted
            ? academyText(locale, "completed")
            : lessonProgress
              ? academyText(locale, "inProgress")
              : academyText(locale, "notStarted");
          return (
            <Pressable
              key={lesson.id}
              accessibilityRole="button"
              accessibilityLabel={`${locale === "ar" ? lesson.titleAr : lesson.title}, ${statusLabel}`}
              onPress={() => router.push({ pathname: "/lesson/[slug]", params: { slug: lesson.slug } })}
              style={({ pressed }) => [styles.lessonCard, pressed && academySharedStyles.pressed]}
            >
              <View style={[styles.lessonHeader, isRTL && academySharedStyles.rowReverse]}>
                <View style={styles.lessonNumber}>
                  <Text style={styles.lessonNumberText}>{String(lesson.lessonNumber).padStart(2, "0")}</Text>
                </View>
                <View style={styles.lessonHeading}>
                  <Text style={[styles.lessonTitle, isRTL && academySharedStyles.rtlText]}>
                    {locale === "ar" ? lesson.titleAr : lesson.title}
                  </Text>
                  <Text style={[styles.lessonMeta, isRTL && academySharedStyles.rtlText]}>
                    {lesson.durationMinutes} {academyText(locale, "minutes")} · {academyDifficultyLabel(lesson.difficulty, locale)}
                  </Text>
                </View>
              </View>
              <Text style={[styles.lessonDescription, isRTL && academySharedStyles.rtlText]}>
                {locale === "ar" ? lesson.descriptionAr : lesson.description}
              </Text>
              <View style={[styles.lessonFooter, isRTL && academySharedStyles.rowReverse]}>
                <Text style={[styles.status, lessonProgress?.lessonCompleted && styles.statusComplete]}>{statusLabel}</Text>
                <Text style={styles.openLesson}>{academyText(locale, "openLesson")} {isRTL ? "‹" : "›"}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
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
  lessonsBlock: { gap: spacing.md },
  lessonsTitle: { color: colors.text, fontSize: typography.section, fontWeight: "900" },
  lessonCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    minHeight: 190,
    padding: spacing.lg,
  },
  lessonHeader: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  lessonNumber: {
    alignItems: "center",
    backgroundColor: "rgba(216, 180, 74, 0.10)",
    borderColor: colors.borderGold,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  lessonNumberText: { color: colors.goldBright, fontSize: typography.body, fontWeight: "900" },
  lessonHeading: { flex: 1, gap: spacing.xs },
  lessonTitle: { color: colors.text, fontSize: typography.body, fontWeight: "900", lineHeight: 23 },
  lessonMeta: { color: colors.textMuted, fontSize: typography.small, lineHeight: 20 },
  lessonDescription: { color: colors.textMuted, fontSize: typography.body, lineHeight: 24 },
  lessonFooter: { alignItems: "center", flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  status: { color: colors.textMuted, fontSize: typography.small, fontWeight: "800" },
  statusComplete: { color: colors.success },
  openLesson: { color: colors.goldBright, fontSize: typography.small, fontWeight: "900" },
});
