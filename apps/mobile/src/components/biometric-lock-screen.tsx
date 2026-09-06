import { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { useAuth } from "../auth/auth-context";
import { useLocale } from "../i18n/locale-context";
import { useBiometricLock } from "../security/biometric-lock-context";
import { BrandMark } from "./brand-mark";
import { GoldButton } from "./gold-button";
import { LanguageSwitch } from "./language-switch";

export function BiometricLockScreen() {
  const { logout, isBusy } = useAuth();
  const { isRTL, t } = useLocale();
  const biometric = useBiometricLock();
  const attemptedAutomatically = useRef(false);

  useEffect(() => {
    if (!biometric.isAppActive || biometric.isAuthenticating || attemptedAutomatically.current) return;
    attemptedAutomatically.current = true;
    void biometric.unlock();
  }, [biometric]);

  const errorMessage = biometric.lastError === "invalidated"
    ? t("biometricChanged")
    : biometric.lastError === "unsupported" || !biometric.isSupported
      ? t("biometricUnavailable")
      : biometric.lastError === "failed"
        ? t("biometricFailed")
        : null;

  async function signOut() {
    try {
      await biometric.reset();
    } finally {
      await logout();
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <BrandMark compact />
        <View style={styles.card}>
          <View style={styles.lockIcon}>
            <Text style={styles.lockGlyph}>◆</Text>
          </View>
          <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>
            {t("biometricLockTitle")}
          </Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>{t("biometricLockBody")}</Text>
          {errorMessage ? (
            <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>
              {errorMessage}
            </Text>
          ) : null}
          {biometric.lastError !== "invalidated" ? (
            <GoldButton loading={biometric.isAuthenticating} onPress={() => void biometric.unlock()}>
              {t("unlockApp")}
            </GoldButton>
          ) : null}
          <GoldButton loading={isBusy} onPress={() => void signOut()} variant="outline">
            {t("signOutInstead")}
          </GoldButton>
        </View>
        <LanguageSwitch />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { flex: 1, gap: spacing.xl, justifyContent: "center", padding: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.borderGold,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.xl,
  },
  lockIcon: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "rgba(216, 180, 74, 0.12)",
    borderColor: colors.borderGold,
    borderRadius: 36,
    borderWidth: 1,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  lockGlyph: { color: colors.goldBright, fontSize: typography.title, fontWeight: "900" },
  title: { color: colors.text, fontSize: typography.title, fontWeight: "900", lineHeight: 32, textAlign: "center" },
  body: { color: colors.textMuted, fontSize: typography.body, lineHeight: 24, textAlign: "center" },
  error: { color: colors.warning, fontSize: typography.small, lineHeight: 21, textAlign: "center" },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
});
