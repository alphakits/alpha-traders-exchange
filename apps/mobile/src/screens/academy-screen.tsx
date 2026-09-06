import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Redirect, useRouter } from "expo-router";
import type { MobileAcademyCourse } from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { useAuth } from "../auth/auth-context";
import { BrandMark } from "../components/brand-mark";
import { GoldButton } from "../components/gold-button";
import { LanguageSwitch } from "../components/language-switch";
import { useLocale } from "../i18n/locale-context";
import { useAcademyCatalog } from "../academy/use-academy";
import { useAcademyProgress } from "../academy/academy-progress-context";
import {
  academyCourseProgressPercent,
  latestAcademyProgress,
} from "../academy/academy-progress";
import { academyLevelLabel, academyText } from "../academy/academy-copy";
import { AcademyProgressBar, academySharedStyles } from "../academy/academy-ui";

export function AcademyScreen() {
  const router = useRouter();
  const { status, user } = useAuth();
  const { locale, isRTL } = useLocale();
  const query = useAcademyCatalog();
  const academyProgress = useAcademyProgress();
  const courses = query.data?.courses ?? [];

  const resumeLesson = (() => {
    const latest = latestAcademyProgress(academyProgress.progress);
    if (!latest) return null;
    return courses.flatMap((course) => course.lessons).find((lesson) => lesson.id === latest.lessonId) ?? null;
  })();

  if (status !== "authenticated" || !user) return <Redirect href="/(public)/login" />;

  function openCourse(course: MobileAcademyCourse) {
    router.push({
      pathname: "/academy/[courseSlug]",
      params: { courseSlug: course.slug },
    });
  }

  function renderCourse({ item }: { item: MobileAcademyCourse }) {
    const progress = academyCourseProgressPercent(
      item.lessons.map((lesson) => lesson.id),
      academyProgress.progress,
    );
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${locale === "ar" ? item.titleAr : item.title}, ${progress}%`}
        onPress={() => openCourse(item)}
        style={({ pressed }) => [styles.courseCard, pressed && academySharedStyles.pressed]}
      >
        <View style={[styles.cardTop, isRTL && academySharedStyles.rowReverse]}>
          <View style={styles.levelBadge}>
            <Text style={styles.levelText}>{academyLevelLabel(item.level, locale)}</Text>
          </View>
          <Text style={styles.lessonCount}>
            {item.lessons.length} {academyText(locale, "publishedLessons")}
          </Text>
        </View>
        <Text style={[styles.courseTitle, isRTL && academySharedStyles.rtlText]}>
          {locale === "ar" ? item.titleAr : item.title}
        </Text>
        <Text style={[styles.courseSummary, isRTL && academySharedStyles.rtlText]}>
          {locale === "ar" ? item.summaryAr : item.summary}
        </Text>
        <View style={styles.progressArea}>
          <Text style={[styles.progressLabel, isRTL && academySharedStyles.rtlText]}>
            {academyText(locale, "courseProgress")}
          </Text>
          <AcademyProgressBar value={progress} label={academyText(locale, "courseProgress")} />
        </View>
        <View style={[styles.openRow, isRTL && academySharedStyles.rowReverse]}>
          <Text style={styles.openText}>{academyText(locale, "openTrack")}</Text>
          <Text style={styles.chevron}>{isRTL ? "‹" : "›"}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={academySharedStyles.screen}>
      <FlatList
        data={courses}
        keyExtractor={(course) => course.id}
        renderItem={renderCourse}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={colors.gold}
          />
        )}
        ListHeaderComponent={(
          <View style={styles.header}>
            <View style={[styles.brandRow, isRTL && academySharedStyles.rowReverse]}>
              <BrandMark compact />
              <LanguageSwitch />
            </View>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={[academySharedStyles.title, isRTL && academySharedStyles.rtlText]}>
                {academyText(locale, "title")}
              </Text>
              <Text style={[academySharedStyles.subtitle, isRTL && academySharedStyles.rtlText]}>
                {academyText(locale, "subtitle")}
              </Text>
            </View>
            {resumeLesson ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: "/lesson/[slug]", params: { slug: resumeLesson.slug } })}
                style={({ pressed }) => [styles.resumeCard, pressed && academySharedStyles.pressed]}
              >
                <Text style={[styles.resumeEyebrow, isRTL && academySharedStyles.rtlText]}>
                  {academyText(locale, "continueLearning")}
                </Text>
                <Text style={[styles.resumeTitle, isRTL && academySharedStyles.rtlText]}>
                  {locale === "ar" ? resumeLesson.titleAr : resumeLesson.title}
                </Text>
                <Text style={[styles.resumeAction, isRTL && academySharedStyles.rtlText]}>
                  {academyText(locale, "resumeLesson")} {isRTL ? "‹" : "›"}
                </Text>
              </Pressable>
            ) : null}
            <Text accessibilityRole="header" style={[styles.pathTitle, isRTL && academySharedStyles.rtlText]}>
              {academyText(locale, "learningPath")}
            </Text>
          </View>
        )}
        ListEmptyComponent={query.isLoading || !academyProgress.isReady ? (
          <ActivityIndicator accessibilityLabel={academyText(locale, "title")} color={colors.gold} size="large" style={styles.loader} />
        ) : query.isError ? (
          <View style={styles.empty}>
            <Text accessibilityRole="alert" style={[styles.emptyTitle, isRTL && academySharedStyles.rtlText]}>
              {academyText(locale, "loadError")}
            </Text>
            <Text style={[styles.emptyBody, isRTL && academySharedStyles.rtlText]}>
              {academyText(locale, "cachedHint")}
            </Text>
            <GoldButton onPress={() => void query.refetch()} variant="outline">
              {locale === "ar" ? "حاول مجددًا" : "Try again"}
            </GoldButton>
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, isRTL && academySharedStyles.rtlText]}>
              {academyText(locale, "emptyTitle")}
            </Text>
            <Text style={[styles.emptyBody, isRTL && academySharedStyles.rtlText]}>
              {academyText(locale, "emptyBody")}
            </Text>
          </View>
        )}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingBottom: spacing.hero,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  header: { gap: spacing.xl, marginBottom: spacing.lg },
  brandRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  heading: { gap: spacing.sm },
  pathTitle: { color: colors.text, fontSize: typography.section, fontWeight: "900" },
  resumeCard: {
    backgroundColor: "rgba(216, 180, 74, 0.10)",
    borderColor: colors.borderGold,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    minHeight: 132,
    padding: spacing.lg,
  },
  resumeEyebrow: { color: colors.goldBright, fontSize: typography.caption, fontWeight: "900", letterSpacing: 1 },
  resumeTitle: { color: colors.text, fontSize: typography.section, fontWeight: "900", lineHeight: 27 },
  resumeAction: { color: colors.goldBright, fontSize: typography.body, fontWeight: "800" },
  courseCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    minHeight: 260,
    padding: spacing.lg,
  },
  cardTop: { alignItems: "center", flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  levelBadge: {
    backgroundColor: "rgba(216, 180, 74, 0.10)",
    borderColor: colors.borderGold,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  levelText: { color: colors.goldBright, fontSize: typography.caption, fontWeight: "900" },
  lessonCount: { color: colors.textMuted, fontSize: typography.caption },
  courseTitle: { color: colors.text, fontSize: typography.section, fontWeight: "900", lineHeight: 27 },
  courseSummary: { color: colors.textMuted, fontSize: typography.body, lineHeight: 24 },
  progressArea: { gap: spacing.sm },
  progressLabel: { color: colors.textMuted, fontSize: typography.small, fontWeight: "700" },
  openRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" },
  openText: { color: colors.goldBright, fontSize: typography.body, fontWeight: "800" },
  chevron: { color: colors.goldBright, fontSize: 24, fontWeight: "900" },
  separator: { height: spacing.md },
  loader: { marginTop: spacing.hero },
  empty: { gap: spacing.lg, marginTop: spacing.xxl },
  emptyTitle: { color: colors.text, fontSize: typography.section, fontWeight: "900", textAlign: "center" },
  emptyBody: { color: colors.textMuted, fontSize: typography.body, lineHeight: 24, textAlign: "center" },
});
