import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MobileNotificationPreferences } from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { getMobileNotificationPreferences, updateMobileNotificationPreferences } from "../src/api/mobile-api";
import { useAuth } from "../src/auth/auth-context";
import { GoldButton } from "../src/components/gold-button";
import { LanguageSwitch } from "../src/components/language-switch";
import { NativePageShell } from "../src/components/native-page-shell";
import { useLocale } from "../src/i18n/locale-context";
import { useBiometricLock } from "../src/security/biometric-lock-context";
import { AccountProfilePanel } from "../src/screens/account-profile-panel";

export default function SettingsScreen() {
  const router = useRouter();
  const { status, user, requestWithSession } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const biometric = useBiometricLock();
  const isAr = locale === "ar";
  const queryClient = useQueryClient();
  const notificationKey = ["mobile-notification-preferences", user?.id ?? "anonymous", locale] as const;
  const notificationQuery = useQuery({
    enabled: status === "authenticated" && Boolean(user),
    queryKey: notificationKey,
    queryFn: ({ signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileNotificationPreferences(tokens, requestLocale, signal)),
  });
  const notificationMutation = useMutation({
    mutationFn: (preferences: Partial<MobileNotificationPreferences>) => requestWithSession((tokens, requestLocale) =>
      updateMobileNotificationPreferences(tokens, requestLocale, preferences)),
    onSuccess: (response) => {
      queryClient.setQueryData(notificationKey, response);
    },
    onError: (error) => Alert.alert(
      isAr ? "تعذر حفظ الإشعارات" : "Could not save notifications",
      error instanceof Error ? error.message : t("genericError"),
    ),
  });
  if (status !== "authenticated" || !user) return <Redirect href="/(public)/login" />;

  async function toggleBiometricLock() {
    const result = biometric.isEnabled ? await biometric.disable() : await biometric.enable();
    if (result === "success") return;
    Alert.alert(
      t("biometricSecurity"),
      result === "unsupported" ? t("biometricUnavailable") : result === "invalidated" ? t("biometricChanged") : t("biometricFailed"),
    );
  }

  return (
    <NativePageShell
      authenticated
      title={isAr ? "الإعدادات" : "Settings"}
      subtitle={isAr ? "ملفك وخصوصيتك وأمان التطبيق." : "Your profile, privacy, and app security."}
    >
      <AccountProfilePanel />
      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{t("language")}</Text>
        <LanguageSwitch />
      </View>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{isAr ? "الإشعارات" : "Notifications"}</Text>
        <Text style={[styles.body, isRTL && styles.rtlText]}>
          {isAr ? "اختر القنوات التي تستخدمها Alpha Traders لإرسال تحديثات الحساب والصفقات." : "Choose how Alpha Traders sends account and trade updates."}
        </Text>
        {notificationQuery.isLoading ? <Text style={[styles.body, isRTL && styles.rtlText]}>{t("loading")}</Text> : null}
        {notificationQuery.data ? (
          <View style={styles.preferenceList}>
            <PreferenceToggle
              checked={notificationQuery.data.preferences.inApp}
              disabled={notificationMutation.isPending}
              isRTL={isRTL}
              label={isAr ? "إشعارات داخل التطبيق" : "In-app notifications"}
              onChange={(value) => notificationMutation.mutate({ inApp: value })}
            />
            <PreferenceToggle
              checked={notificationQuery.data.preferences.email}
              disabled={notificationMutation.isPending}
              isRTL={isRTL}
              label={isAr ? "إشعارات البريد الإلكتروني" : "Email notifications"}
              onChange={(value) => notificationMutation.mutate({ email: value })}
            />
            <PreferenceToggle
              checked={notificationQuery.data.preferences.sms}
              disabled={notificationMutation.isPending || !notificationQuery.data.phone.verified}
              isRTL={isRTL}
              label={isAr ? "رسائل SMS" : "SMS notifications"}
              onChange={(value) => notificationMutation.mutate({ sms: value })}
            />
            {!notificationQuery.data.phone.verified ? (
              <Text style={[styles.warning, isRTL && styles.rtlText]}>
                {isAr ? "يجب توثيق رقم هاتف على الموقع قبل تفعيل SMS." : "A verified phone number is required before SMS can be enabled."}
              </Text>
            ) : notificationQuery.data.phone.masked ? (
              <Text style={[styles.status, isRTL && styles.rtlText]}>{notificationQuery.data.phone.masked}</Text>
            ) : null}
          </View>
        ) : null}
        {notificationQuery.isError ? (
          <GoldButton onPress={() => void notificationQuery.refetch()} variant="ghost">{t("refresh")}</GoldButton>
        ) : null}
      </View>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{t("biometricSecurity")}</Text>
        <Text style={[styles.body, isRTL && styles.rtlText]}>{t("biometricSecurityBody")}</Text>
        <Text style={[styles.status, biometric.isEnabled && styles.enabled, isRTL && styles.rtlText]}>
          {biometric.isEnabled ? `✓ ${t("biometricEnabled")}` : t("biometricDisabled")}
        </Text>
        {biometric.isSupported || biometric.isEnabled ? (
          <GoldButton
            loading={biometric.isAuthenticating || biometric.isChecking}
            onPress={() => void toggleBiometricLock()}
            variant="outline"
          >
            {biometric.isEnabled ? t("disableBiometric") : t("enableBiometric")}
          </GoldButton>
        ) : <Text style={[styles.warning, isRTL && styles.rtlText]}>{t("biometricUnavailable")}</Text>}
      </View>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{isAr ? "كلمة المرور" : "Password"}</Text>
        <Text style={[styles.body, isRTL && styles.rtlText]}>
          {isAr ? "استخدم مسار إعادة تعيين كلمة المرور الآمن لتغييرها." : "Use the secure password-reset flow to change your password."}
        </Text>
        <GoldButton onPress={() => router.push("/(public)/forgot-password")} variant="outline">
          {isAr ? "إعادة تعيين كلمة المرور" : "Reset password"}
        </GoldButton>
      </View>
    </NativePageShell>
  );
}

function PreferenceToggle({ checked, disabled, isRTL, label, onChange }: {
  checked: boolean;
  disabled: boolean;
  isRTL: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [styles.preferenceRow, isRTL && styles.rowReverse, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={[styles.preferenceLabel, isRTL && styles.rtlText]}>{label}</Text>
      <View style={[styles.switchTrack, checked && styles.switchTrackEnabled]}>
        <View style={[styles.switchKnob, checked && styles.switchKnobEnabled]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: typography.section,
    fontWeight: "900",
  },
  body: {
    color: colors.textMuted,
    fontSize: typography.small,
    lineHeight: 21,
  },
  status: {
    color: colors.textMuted,
    fontSize: typography.small,
    fontWeight: "800",
  },
  enabled: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
    fontSize: typography.small,
  },
  preferenceList: { gap: spacing.sm },
  preferenceRow: { alignItems: "center", backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flexDirection: "row", gap: spacing.md, justifyContent: "space-between", minHeight: 54, paddingHorizontal: spacing.md },
  preferenceLabel: { color: colors.text, flex: 1, fontSize: typography.small, fontWeight: "700" },
  switchTrack: { backgroundColor: "rgba(255,255,255,0.12)", borderRadius: radius.pill, height: 26, justifyContent: "center", paddingHorizontal: 3, width: 46 },
  switchTrackEnabled: { backgroundColor: colors.gold },
  switchKnob: { backgroundColor: colors.text, borderRadius: 10, height: 20, width: 20 },
  switchKnobEnabled: { alignSelf: "flex-end", backgroundColor: colors.background },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  rowReverse: { flexDirection: "row-reverse" },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
