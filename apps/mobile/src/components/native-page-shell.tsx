import type { PropsWithChildren } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { useLocale } from "../i18n/locale-context";
import { NativeSiteHeader } from "./native-site-header";

type NativePageShellProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  authenticated?: boolean;
}>;

export function NativePageShell({ children, title, subtitle }: NativePageShellProps) {
  const router = useRouter();
  const { isRTL } = useLocale();
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <NativeSiteHeader />
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.backRow, isRTL && styles.rowReverse]}>
          <Text
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.back}
          >
            {isRTL ? "→ رجوع" : "← Back"}
          </Text>
        </View>
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{title}</Text>
          {subtitle ? <Text style={[styles.subtitle, isRTL && styles.rtlText]}>{subtitle}</Text> : null}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: "transparent",
    flex: 1,
  },
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.hero,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  backRow: {
    flexDirection: "row",
  },
  back: {
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    color: colors.goldBright,
    fontSize: typography.small,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  intro: {
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -0.8,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 25,
  },
  rowReverse: {
    flexDirection: "row-reverse",
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
