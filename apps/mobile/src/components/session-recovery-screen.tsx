import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { useAuth } from "../auth/auth-context";
import { useLocale } from "../i18n/locale-context";
import { BrandMark } from "./brand-mark";
import { GoldButton } from "./gold-button";
import { LanguageSwitch } from "./language-switch";

export function SessionRecoveryScreen() {
  const { retryBootstrap } = useAuth();
  const { isRTL, t } = useLocale();
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <BrandMark compact />
        <View style={styles.card}>
          <View style={styles.statusIcon}>
            <Text style={styles.statusIconLabel}>↻</Text>
          </View>
          <Text style={[styles.title, isRTL && styles.rtlText]}>{t("connectionTitle")}</Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>{t("connectionBody")}</Text>
          <GoldButton onPress={() => void retryBootstrap()}>{t("retryConnection")}</GoldButton>
        </View>
        <LanguageSwitch />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    flex: 1,
    gap: spacing.xl,
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.xl,
  },
  statusIcon: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(216, 180, 74, 0.12)",
    borderColor: colors.borderGold,
    borderRadius: 26,
    borderWidth: 1,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  statusIconLabel: {
    color: colors.goldBright,
    fontSize: typography.title,
    fontWeight: "900",
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: "900",
    lineHeight: 31,
  },
  body: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 24,
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
