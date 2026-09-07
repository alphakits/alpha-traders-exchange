import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MobileLocale } from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { useLocale } from "../i18n/locale-context";

export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLocale();
  if (compact) {
    const nextLocale: MobileLocale = locale === "ar" ? "en" : "ar";
    const label = locale === "ar" ? "Switch to English" : "التبديل إلى العربية";
    return (
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={() => void setLocale(nextLocale)}
        style={({ pressed }) => [styles.compact, pressed && styles.pressed]}
      >
        <Text accessible={false} style={styles.globe}>◎</Text>
        <Text style={styles.compactLabel}>{nextLocale.toUpperCase()}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.container} accessibilityRole="radiogroup">
      {(["ar", "en"] as const).map((value: MobileLocale) => {
        const selected = value === locale;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            key={value}
            onPress={() => void setLocale(value)}
            style={[styles.option, selected && styles.optionSelected]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>
              {value === "ar" ? t("arabic") : t("english")}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  compact: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.20)",
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 62,
    paddingHorizontal: spacing.sm,
  },
  compactLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: "800",
  },
  globe: {
    color: colors.textMuted,
    fontSize: 17,
    fontWeight: "800",
  },
  pressed: {
    borderColor: colors.gold,
    opacity: 0.78,
  },
  container: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    padding: spacing.xs,
  },
  option: {
    alignItems: "center",
    borderRadius: radius.pill,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  optionSelected: {
    backgroundColor: colors.gold,
  },
  label: {
    color: colors.textMuted,
    fontSize: typography.small,
    fontWeight: "700",
  },
  labelSelected: {
    color: colors.background,
  },
});
