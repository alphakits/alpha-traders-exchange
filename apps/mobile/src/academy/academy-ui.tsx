import type { PropsWithChildren } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";

export function AcademyProgressBar({ value, label }: { value: number; label: string }) {
  const bounded = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: bounded }}
      style={styles.progressBlock}
    >
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${bounded}%` }]} />
      </View>
      <Text style={styles.progressValue}>{bounded}%</Text>
    </View>
  );
}

export function AcademySection({
  title,
  isRTL,
  children,
}: PropsWithChildren<{ title: string; isRTL: boolean }>) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function AcademyBulletList({ items, isRTL }: { items: string[]; isRTL: boolean }) {
  return (
    <View style={styles.list}>
      {items.map((item, index) => (
        <View key={`${item}-${index}`} style={[styles.bulletRow, isRTL && styles.rowReverse]}>
          <View style={styles.bullet} />
          <Text style={[styles.bulletText, isRTL && styles.rtlText]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export function AcademyBackButton({
  label,
  isRTL,
  onPress,
}: {
  label: string;
  isRTL: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.backButton, isRTL && styles.rowReverse, pressed && styles.pressed]}
    >
      <Text style={styles.backArrow}>{isRTL ? "›" : "‹"}</Text>
      <Text style={[styles.backLabel, isRTL && styles.rtlText]}>{label}</Text>
    </Pressable>
  );
}

export const academySharedStyles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.hero,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: "900",
    lineHeight: 32,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 24,
  },
  eyebrow: {
    color: colors.goldBright,
    fontSize: typography.caption,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  cardTitle: {
    color: colors.text,
    fontSize: typography.section,
    fontWeight: "800",
    lineHeight: 26,
  },
  body: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 25,
  },
  small: {
    color: colors.textMuted,
    fontSize: typography.small,
    lineHeight: 20,
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  rowReverse: {
    flexDirection: "row-reverse",
  },
  pressed: {
    opacity: 0.74,
    transform: [{ scale: 0.995 }],
  },
});

const styles = StyleSheet.create({
  progressBlock: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  progressTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    flex: 1,
    height: 9,
    overflow: "hidden",
  },
  progressFill: {
    backgroundColor: colors.gold,
    borderRadius: radius.pill,
    height: "100%",
  },
  progressValue: {
    color: colors.goldBright,
    fontSize: typography.small,
    fontVariant: ["tabular-nums"],
    fontWeight: "900",
    minWidth: 38,
    textAlign: "right",
  },
  section: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.section,
    fontWeight: "800",
    lineHeight: 27,
  },
  list: {
    gap: spacing.sm,
  },
  bulletRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
  },
  bullet: {
    backgroundColor: colors.gold,
    borderRadius: radius.pill,
    height: 7,
    marginTop: 9,
    width: 7,
  },
  bulletText: {
    color: colors.textMuted,
    flex: 1,
    fontSize: typography.body,
    lineHeight: 25,
  },
  backButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  backArrow: {
    color: colors.goldBright,
    fontSize: 26,
    fontWeight: "700",
  },
  backLabel: {
    color: colors.text,
    fontSize: typography.small,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.74,
  },
  rowReverse: {
    flexDirection: "row-reverse",
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
