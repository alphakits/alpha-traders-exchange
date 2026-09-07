import { Image, StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "@alpha-traders/design-tokens";
import { useLocale } from "../i18n/locale-context";
import logo from "../../../../public/images/brand/alpha-traders-logo-512.png";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const { t, isRTL } = useLocale();
  return (
    <View style={[styles.row, isRTL && styles.rowRtl]} accessibilityRole="header">
      <Image
        accessibilityLabel={`${t("brand")} ${t("brandSubtitle")}`}
        alt={`${t("brand")} ${t("brandSubtitle")}`}
        source={logo}
        style={[styles.mark, compact && styles.markCompact]}
      />
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
    borderColor: colors.gold,
    borderRadius: 14,
    borderWidth: 1,
    height: 52,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    width: 52,
  },
  markCompact: {
    borderRadius: 12,
    height: 44,
    width: 44,
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
