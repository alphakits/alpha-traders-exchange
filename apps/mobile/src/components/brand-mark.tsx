import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "@alpha-traders/design-tokens";
import { useLocale } from "../i18n/locale-context";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const { t, isRTL } = useLocale();
  return (
    <View style={[styles.row, isRTL && styles.rowRtl]} accessibilityRole="header">
      <View style={[styles.mark, compact && styles.markCompact]}>
        <Text style={[styles.letter, compact && styles.letterCompact]}>A</Text>
      </View>
      <View style={styles.copy}>
        <Text style={[styles.name, isRTL && styles.rtlText]}>{t("brand")}</Text>
        <Text style={[styles.subtitle, isRTL && styles.rtlText]}>{t("brandSubtitle")}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  rowRtl: {
    flexDirection: "row-reverse",
  },
  mark: {
    alignItems: "center",
    borderColor: colors.gold,
    borderRadius: 26,
    borderWidth: 1.5,
    height: 52,
    justifyContent: "center",
    shadowColor: colors.gold,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    width: 52,
  },
  markCompact: {
    borderRadius: 20,
    height: 40,
    width: 40,
  },
  letter: {
    color: colors.goldBright,
    fontSize: 26,
    fontWeight: "800",
  },
  letterCompact: {
    fontSize: 20,
  },
  copy: {
    flexShrink: 1,
  },
  name: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  subtitle: {
    color: colors.gold,
    fontSize: typography.caption,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginTop: 2,
  },
  rtlText: {
    letterSpacing: 0,
    textAlign: "right",
    writingDirection: "rtl",
  },
});
