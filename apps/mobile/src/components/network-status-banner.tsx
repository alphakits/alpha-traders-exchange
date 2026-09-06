import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, typography } from "@alpha-traders/design-tokens";
import { useLocale } from "../i18n/locale-context";
import { useNetworkStatus } from "../network/network-context";

export function NetworkStatusBanner() {
  const insets = useSafeAreaInsets();
  const { isRTL, t } = useLocale();
  const { isOnline } = useNetworkStatus();
  if (isOnline !== false) return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[styles.banner, { paddingTop: Math.max(insets.top, spacing.sm) }]}
    >
      <Text style={[styles.title, isRTL && styles.rtlText]}>{t("networkOfflineTitle")}</Text>
      <Text style={[styles.body, isRTL && styles.rtlText]}>{t("networkOfflineBody")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.surfaceRaised,
    borderBottomColor: colors.warning,
    borderBottomWidth: 1,
    gap: spacing.xs,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  title: {
    color: colors.warning,
    fontSize: typography.small,
    fontWeight: "900",
    textAlign: "center",
  },
  body: {
    color: colors.textMuted,
    fontSize: typography.caption,
    lineHeight: 16,
    textAlign: "center",
  },
  rtlText: {
    writingDirection: "rtl",
  },
});
