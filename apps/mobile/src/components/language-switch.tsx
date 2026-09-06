import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MobileLocale } from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { useLocale } from "../i18n/locale-context";

export function LanguageSwitch() {
  const { locale, setLocale, t } = useLocale();
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
    minHeight: 40,
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
