import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { MobileApiError, resendVerificationMobile } from "../../src/api/mobile-api";
import { useAuth } from "../../src/auth/auth-context";
import { GoldButton } from "../../src/components/gold-button";
import { NativeSiteHeader } from "../../src/components/native-site-header";
import { useLocale } from "../../src/i18n/locale-context";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    listingId?: string | string[];
    tradeMode?: string | string[];
    destination?: string | string[];
  }>();
  const { login, status, user, isBusy } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [requiresVerification, setRequiresVerification] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const listingId = firstParam(params.listingId);
  const rawTradeMode = firstParam(params.tradeMode);
  const destination = firstParam(params.destination);
  const tradeMode = rawTradeMode === "offer" ? "offer" : "buy";
  const hasTradeDestination = typeof listingId === "string"
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(listingId);

  useEffect(() => {
    if (status !== "authenticated" || !user) return;
    const needsOnboarding = !user.onboardingSelection
      && !user.onboardingCompletedAt
      && user.roles.length === 1
      && user.roles[0] === "guest";
    if (needsOnboarding) {
      router.replace({
        pathname: "/onboarding",
        params: {
          ...(destination ? { destination } : {}),
          ...(hasTradeDestination ? { listingId, tradeMode } : {}),
        },
      });
      return;
    }
    if (hasTradeDestination) {
      router.replace({
        pathname: "/trade/new/[listingId]",
        params: { listingId, mode: tradeMode },
      });
      return;
    }
    if (destination === "academy") {
      router.replace("/(tabs)/academy");
      return;
    }
    if (destination === "exchange") {
      router.replace("/(tabs)/market");
      return;
    }
    if (user.roles.some((role) => role === "owner" || role === "admin")) {
      router.replace("/admin");
      return;
    }
    if (user.roles.includes("approved_seller") || user.sellerStatus === "approved_seller") {
      router.replace("/(tabs)/seller");
      return;
    }
    router.replace("/(tabs)");
  }, [destination, hasTradeDestination, listingId, router, status, tradeMode, user]);

  async function submit() {
    setError(null);
    setStatusMessage(null);
    setRequiresVerification(false);
    if (!EMAIL_PATTERN.test(email.trim()) || password.length < 8) {
      setError(t("invalidFields"));
      return;
    }
    try {
      await login(email, password, rememberMe);
    } catch (caught) {
      if (caught instanceof MobileApiError) {
        setRequiresVerification(caught.code === "EMAIL_VERIFICATION_REQUIRED");
        setError(caught.message);
      } else {
        setError(t("genericError"));
      }
    }
  }

  async function resendVerification() {
    if (!EMAIL_PATTERN.test(email.trim()) || isResending) return;
    setError(null);
    setStatusMessage(null);
    setIsResending(true);
    try {
      const response = await resendVerificationMobile(email.trim().toLowerCase(), locale);
      setStatusMessage(response.message ?? (locale === "ar"
        ? "إذا كان الحساب موجودًا وغير موثق، تم إرسال رسالة تحقق جديدة."
        : "If the account exists and is unverified, a new verification email has been sent."));
      setRequiresVerification(false);
    } catch (caught) {
      setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
    } finally {
      setIsResending(false);
    }
  }

  const benefits = [
    t("loginBenefitAcademyProgress"),
    t("loginBenefitCourses"),
    t("loginBenefitTrading"),
    t("loginBenefitNotifications"),
    t("loginBenefitProfile"),
    t("loginBenefitJourney"),
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <NativeSiteHeader />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.loginCard}>
            <View pointerEvents="none" style={styles.goldGlow} />
            <View style={styles.formContent}>
              <Text style={[styles.badge, isRTL && styles.rtlText]}>{t("premiumSignIn")}</Text>
              <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{t("websiteLoginTitle")}</Text>
              <Text style={[styles.body, isRTL && styles.rtlText]}>{t("loginWebsiteBody")}</Text>

              <View style={styles.benefits}>
                {benefits.map((benefit) => (
                  <View key={benefit} style={styles.benefitCard}>
                    <Text style={[styles.benefitText, isRTL && styles.rtlText]}>{benefit}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.form}>
                <View style={styles.field}>
                  <Text style={[styles.label, isRTL && styles.rtlText]}>{t("email")}</Text>
                  <TextInput
                    accessibilityLabel={t("email")}
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={false}
                    editable={!isBusy}
                    inputMode="email"
                    maxLength={254}
                    onChangeText={setEmail}
                    placeholder={t("emailPlaceholder")}
                    placeholderTextColor="#6B7280"
                    returnKeyType="next"
                    selectionColor={colors.gold}
                    style={[styles.input, isRTL && styles.inputRtl]}
                    textContentType="emailAddress"
                    value={email}
                  />
                </View>
                <View style={styles.field}>
                  <Text style={[styles.label, isRTL && styles.rtlText]}>{t("password")}</Text>
                  <TextInput
                    accessibilityLabel={t("password")}
                    autoCapitalize="none"
                    autoComplete="current-password"
                    editable={!isBusy}
                    maxLength={256}
                    onChangeText={setPassword}
                    onSubmitEditing={() => void submit()}
                    placeholder="••••••••"
                    placeholderTextColor="#6B7280"
                    returnKeyType="go"
                    secureTextEntry
                    selectionColor={colors.gold}
                    style={[styles.input, isRTL && styles.inputRtl]}
                    textContentType="password"
                    value={password}
                  />
                </View>

                <View style={[styles.formOptions, isRTL && styles.rowReverse]}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: rememberMe }}
                    disabled={isBusy}
                    onPress={() => setRememberMe((value) => !value)}
                    style={({ pressed }) => [styles.checkboxRow, isRTL && styles.rowReverse, pressed && styles.pressed]}
                  >
                    <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                      <Text style={styles.checkmark}>{rememberMe ? "✓" : ""}</Text>
                    </View>
                    <Text style={styles.checkboxLabel}>{t("rememberMe")}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="link"
                    disabled={isBusy}
                    onPress={() => router.push("/(public)/forgot-password")}
                    style={({ pressed }) => [styles.textLinkTarget, pressed && styles.pressed]}
                  >
                    <Text style={styles.link}>{t("forgotYourPassword")}</Text>
                  </Pressable>
                </View>

                {error ? <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{error}</Text> : null}
                {statusMessage ? <Text accessibilityRole="alert" style={[styles.success, isRTL && styles.rtlText]}>{statusMessage}</Text> : null}
                {requiresVerification ? (
                  <GoldButton loading={isResending} onPress={() => void resendVerification()} variant="outline">
                    {locale === "ar" ? "إعادة إرسال بريد التحقق" : "Resend verification email"}
                  </GoldButton>
                ) : null}

                <GoldButton loading={isBusy} onPress={() => void submit()}>{t("websiteLoginTitle")}</GoldButton>
              </View>

              <View style={[styles.createAccountRow, isRTL && styles.rowReverse]}>
                <Text style={styles.accountPrompt}>{t("noAccount")}</Text>
                <Pressable
                  accessibilityRole="link"
                  disabled={isBusy}
                  onPress={() => router.push("/(public)/register")}
                  style={({ pressed }) => [styles.textLinkTarget, pressed && styles.pressed]}
                >
                  <Text style={styles.link}>{t("createAccount")}</Text>
                </Pressable>
              </View>
            </View>
          </View>
          <Text style={[styles.secure, isRTL && styles.rtlText]}>◈ {t("secureSession")}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, gap: spacing.lg, padding: spacing.lg, paddingBottom: 48 },
  loginCard: {
    backgroundColor: "rgba(7,7,7,0.97)",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 28,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.55,
    shadowRadius: 30,
  },
  goldGlow: {
    backgroundColor: "rgba(201,162,39,0.08)",
    borderRadius: 180,
    height: 360,
    left: -80,
    position: "absolute",
    top: -250,
    width: 360,
  },
  formContent: { gap: spacing.lg, padding: spacing.xl },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: radius.pill,
    borderWidth: 1,
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: "800",
    letterSpacing: 1.7,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    textTransform: "uppercase",
  },
  title: { color: colors.text, fontSize: 34, fontWeight: "700", letterSpacing: -0.6 },
  body: { color: colors.textMuted, fontSize: typography.small, lineHeight: 25 },
  benefits: {
    backgroundColor: "rgba(201,162,39,0.06)",
    borderColor: "rgba(201,162,39,0.20)",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.md,
  },
  benefitCard: {
    backgroundColor: "rgba(0,0,0,0.20)",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: "48%",
  },
  benefitText: { color: "#E5E7EB", fontSize: 12, lineHeight: 17 },
  form: { gap: spacing.lg },
  field: { gap: spacing.sm },
  label: { color: colors.textMuted, fontSize: 11, fontWeight: "800", letterSpacing: 1.4, textTransform: "uppercase" },
  input: {
    backgroundColor: "rgba(0,0,0,0.30)",
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: typography.body,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  inputRtl: { textAlign: "right", writingDirection: "rtl" },
  formOptions: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "space-between" },
  checkboxRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm, minHeight: 44 },
  checkbox: { alignItems: "center", borderColor: "rgba(255,255,255,0.30)", borderRadius: 5, borderWidth: 1, height: 22, justifyContent: "center", width: 22 },
  checkboxChecked: { backgroundColor: colors.gold, borderColor: colors.gold },
  checkmark: { color: colors.background, fontSize: typography.small, fontWeight: "900" },
  checkboxLabel: { color: "#D1D5DB", fontSize: typography.small },
  textLinkTarget: { justifyContent: "center", minHeight: 44 },
  link: { color: colors.gold, fontSize: typography.small, fontWeight: "700" },
  error: { backgroundColor: "rgba(244,63,94,0.10)", borderColor: "rgba(244,63,94,0.25)", borderRadius: radius.md, borderWidth: 1, color: "#FECDD3", fontSize: typography.small, lineHeight: 20, padding: spacing.md },
  success: { backgroundColor: "rgba(16,185,129,0.10)", borderColor: "rgba(16,185,129,0.25)", borderRadius: radius.md, borderWidth: 1, color: "#A7F3D0", fontSize: typography.small, lineHeight: 20, padding: spacing.md },
  createAccountRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  accountPrompt: { color: colors.textMuted, fontSize: typography.small },
  secure: { color: colors.goldMuted, fontSize: typography.caption, textAlign: "center" },
  pressed: { opacity: 0.72 },
  rowReverse: { flexDirection: "row-reverse" },
  rtlText: { letterSpacing: 0, textAlign: "right", writingDirection: "rtl" },
});
