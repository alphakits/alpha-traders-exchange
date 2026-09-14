import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MobileNotificationPreferencesUpdateRequest } from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import {
  getMobileNotificationPreferences,
  sendMobilePhoneVerificationCode,
  updateMobileNotificationPreferences,
  verifyMobilePhoneVerificationCode,
} from "../src/api/mobile-api";
import { useAuth } from "../src/auth/auth-context";
import { GoldButton } from "../src/components/gold-button";
import { LanguageSwitch } from "../src/components/language-switch";
import { NativePageShell } from "../src/components/native-page-shell";
import { useLocale } from "../src/i18n/locale-context";
import { useBiometricLock } from "../src/security/biometric-lock-context";
import { AccountProfilePanel } from "../src/screens/account-profile-panel";

function whatsAppAvailabilityMessage(
  status: "ready" | "awaiting_meta_approval" | "not_configured" | "feature_disabled" | "storage_unavailable",
  isAr: boolean,
) {
  if (status === "awaiting_meta_approval") {
    return isAr ? "بانتظار موافقة Meta قبل التفعيل." : "Waiting for Meta approval before activation.";
  }
  if (status === "not_configured") {
    return isAr ? "اتصال WhatsApp غير مكتمل الإعداد بعد." : "The WhatsApp connection is not configured yet.";
  }
  if (status === "storage_unavailable") {
    return isAr ? "إعدادات WhatsApp غير متاحة مؤقتًا." : "WhatsApp settings are temporarily unavailable.";
  }
  if (status === "feature_disabled") {
    return isAr ? "إشعارات WhatsApp غير متاحة بعد." : "WhatsApp notifications are not available yet.";
  }
  return isAr
    ? "تنبيهات خاصة تفتح التفاصيل داخل Alpha Traders."
    : "Private alerts that open details inside Alpha Traders.";
}

export default function SettingsScreen() {
  const router = useRouter();
  const { status, user, requestWithSession, syncSessionUser } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const biometric = useBiometricLock();
  const isAr = locale === "ar";
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneMessage, setPhoneMessage] = useState<string | null>(null);
  const [phoneMessageIsError, setPhoneMessageIsError] = useState(false);
  const notificationKey = ["mobile-notification-preferences", user?.id ?? "anonymous", locale] as const;
  const notificationQuery = useQuery({
    enabled: status === "authenticated" && Boolean(user),
    queryKey: notificationKey,
    queryFn: ({ signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileNotificationPreferences(tokens, requestLocale, signal)),
  });
  const notificationMutation = useMutation({
    mutationFn: (preferences: MobileNotificationPreferencesUpdateRequest) => requestWithSession((tokens, requestLocale) =>
      updateMobileNotificationPreferences(tokens, requestLocale, preferences)),
    onSuccess: (response) => {
      queryClient.setQueryData(notificationKey, response);
    },
    onError: (error) => Alert.alert(
      isAr ? "تعذر حفظ الإشعارات" : "Could not save notifications",
      error instanceof Error ? error.message : t("genericError"),
    ),
  });
  const phoneSendMutation = useMutation({
    mutationFn: (value: string) => requestWithSession((tokens, requestLocale) =>
      sendMobilePhoneVerificationCode(tokens, requestLocale, value)),
    onSuccess: (response) => {
      setPhoneMessageIsError(false);
      setPhoneMessage(response.message || (isAr ? "تم إرسال رمز التحقق." : "Verification code sent."));
    },
    onError: (error) => {
      setPhoneMessageIsError(true);
      setPhoneMessage(error instanceof Error
        ? error.message
        : (isAr ? "تعذر إرسال رمز التحقق." : "Could not send the verification code."));
    },
  });
  const phoneVerifyMutation = useMutation({
    mutationFn: (input: { phone: string; code: string }) => requestWithSession((tokens, requestLocale) =>
      verifyMobilePhoneVerificationCode(tokens, requestLocale, input)),
    onSuccess: async (response) => {
      syncSessionUser(response.user);
      setPhoneCode("");
      setPhoneMessageIsError(false);
      setPhoneMessage(isAr ? "تم توثيق رقم الهاتف." : "Phone number verified.");
      await notificationQuery.refetch();
    },
    onError: (error) => {
      setPhoneMessageIsError(true);
      setPhoneMessage(error instanceof Error
        ? error.message
        : (isAr ? "تعذر التحقق من الرمز." : "Could not verify the code."));
    },
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
            {notificationQuery.data.capabilities.sms ? <PreferenceToggle
              checked={notificationQuery.data.preferences.sms}
              disabled={notificationMutation.isPending || !notificationQuery.data.phone.verified}
              isRTL={isRTL}
              label={isAr ? "رسائل SMS" : "SMS notifications"}
              onChange={(value) => notificationMutation.mutate({ sms: value })}
            /> : null}
            {notificationQuery.data.capabilities.phoneVerification && !notificationQuery.data.phone.verified ? (
              <View style={styles.phoneVerificationPanel}>
                <Text style={[styles.preferenceLabel, isRTL && styles.rtlText]}>
                  {isAr ? "توثيق رقم الهاتف" : "Verify phone number"}
                </Text>
                <Text style={[styles.body, isRTL && styles.rtlText]}>
                  {isAr
                    ? "أدخل رقمك بالصيغة الدولية، ثم أدخل الرمز المكوّن من 6 أرقام."
                    : "Enter your phone in international format, then enter the 6-digit code."}
                </Text>
                <TextInput
                  accessibilityLabel={isAr ? "رقم الهاتف" : "Phone number"}
                  autoComplete="tel"
                  editable={!phoneSendMutation.isPending && !phoneVerifyMutation.isPending}
                  inputMode="tel"
                  maxLength={30}
                  onChangeText={setPhone}
                  placeholder={isAr ? "رقم الهاتف، مثال: ‎+972501234567" : "Phone, e.g. +972501234567"}
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, isRTL && styles.rtlText]}
                  textContentType="telephoneNumber"
                  value={phone}
                />
                <TextInput
                  accessibilityLabel={isAr ? "رمز التحقق المكوّن من 6 أرقام" : "6-digit verification code"}
                  editable={!phoneSendMutation.isPending && !phoneVerifyMutation.isPending}
                  inputMode="numeric"
                  keyboardType="number-pad"
                  maxLength={6}
                  onChangeText={(value) => setPhoneCode(value.replace(/\D/g, "").slice(0, 6))}
                  placeholder={isAr ? "رمز من 6 أرقام" : "6-digit code"}
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.codeInput, isRTL && styles.rtlText]}
                  textContentType="oneTimeCode"
                  value={phoneCode}
                />
                <View style={[styles.phoneActions, isRTL && styles.rowReverse]}>
                  <GoldButton
                    disabled={!phone.trim() || phoneVerifyMutation.isPending}
                    loading={phoneSendMutation.isPending}
                    onPress={() => {
                      setPhoneMessage(null);
                      phoneSendMutation.mutate(phone.trim());
                    }}
                    style={styles.phoneAction}
                    variant="outline"
                  >
                    {isAr ? "إرسال الرمز" : "Send code"}
                  </GoldButton>
                  <GoldButton
                    disabled={!phone.trim() || phoneCode.length !== 6 || phoneSendMutation.isPending}
                    loading={phoneVerifyMutation.isPending}
                    onPress={() => {
                      setPhoneMessage(null);
                      phoneVerifyMutation.mutate({ phone: phone.trim(), code: phoneCode });
                    }}
                    style={styles.phoneAction}
                  >
                    {isAr ? "تحقق" : "Verify"}
                  </GoldButton>
                </View>
                {phoneMessage ? (
                  <Text
                    accessibilityRole="alert"
                    style={[phoneMessageIsError ? styles.error : styles.enabled, styles.phoneMessage, isRTL && styles.rtlText]}
                  >
                    {phoneMessage}
                  </Text>
                ) : null}
              </View>
            ) : notificationQuery.data.capabilities.phoneVerification && notificationQuery.data.phone.masked ? (
              <Text style={[styles.status, isRTL && styles.rtlText]}>{notificationQuery.data.phone.masked}</Text>
            ) : !notificationQuery.data.capabilities.phoneVerification ? (
              <Text style={[styles.status, isRTL && styles.rtlText]}>
                {isAr
                  ? "التحقق من البريد الإلكتروني هو طريقة التحقق الوحيدة المفعّلة حاليًا. التحقق عبر الهاتف ورسائل SMS متوقفان."
                  : "Email verification is the only verification method currently enabled. Phone verification and SMS are off."}
              </Text>
            ) : null}
            <View style={styles.whatsappPanel}>
              <Text style={[styles.preferenceLabel, isRTL && styles.rtlText]}>WhatsApp Business</Text>
              <Text style={[styles.body, isRTL && styles.rtlText]}>
                {whatsAppAvailabilityMessage(notificationQuery.data.whatsapp.status, isAr)}
              </Text>
              <PreferenceToggle
                checked={notificationQuery.data.whatsapp.tradeUpdates}
                disabled={notificationMutation.isPending || !notificationQuery.data.whatsapp.available || !notificationQuery.data.phone.verified}
                isRTL={isRTL}
                label={isAr ? "تحديثات الطلب وغرفة التداول" : "Request and Trade Room updates"}
                onChange={(value) => notificationMutation.mutate({
                  whatsappTradeUpdates: value,
                  whatsappChatMessages: notificationQuery.data.whatsapp.chatMessages,
                  ...((value || notificationQuery.data.whatsapp.chatMessages) ? {
                    whatsappConsentAccepted: true,
                    whatsappConsentVersion: notificationQuery.data.whatsapp.consentVersion,
                  } : {}),
                })}
              />
              <PreferenceToggle
                checked={notificationQuery.data.whatsapp.chatMessages}
                disabled={notificationMutation.isPending || !notificationQuery.data.whatsapp.available || !notificationQuery.data.phone.verified}
                isRTL={isRTL}
                label={isAr ? "تنبيه بوجود رسالة جديدة" : "New message waiting alerts"}
                onChange={(value) => notificationMutation.mutate({
                  whatsappTradeUpdates: notificationQuery.data.whatsapp.tradeUpdates,
                  whatsappChatMessages: value,
                  ...((value || notificationQuery.data.whatsapp.tradeUpdates) ? {
                    whatsappConsentAccepted: true,
                    whatsappConsentVersion: notificationQuery.data.whatsapp.consentVersion,
                  } : {}),
                })}
              />
              <Text style={[styles.consent, isRTL && styles.rtlText]}>
                {notificationQuery.data.whatsapp.consentText}
              </Text>
              {notificationQuery.data.whatsapp.consented ? (
                <GoldButton
                  loading={notificationMutation.isPending}
                  onPress={() => notificationMutation.mutate({
                    whatsappTradeUpdates: false,
                    whatsappChatMessages: false,
                  })}
                  variant="outline"
                >
                  {isAr ? "إيقاف جميع إشعارات WhatsApp" : "Turn off all WhatsApp notifications"}
                </GoldButton>
              ) : null}
            </View>
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
  phoneVerificationPanel: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  input: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, fontSize: typography.body, minHeight: 50, paddingHorizontal: spacing.md },
  codeInput: { letterSpacing: 4 },
  phoneActions: { flexDirection: "row", gap: spacing.sm },
  phoneAction: { flex: 1 },
  phoneMessage: { fontSize: typography.small },
  error: { color: colors.danger },
  whatsappPanel: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  consent: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
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
