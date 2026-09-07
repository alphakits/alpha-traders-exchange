import { useState } from "react";
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
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { MobileApiError, requestPasswordResetMobile } from "../../src/api/mobile-api";
import { GoldButton } from "../../src/components/gold-button";
import { NativeSiteHeader } from "../../src/components/native-site-header";
import { useLocale } from "../../src/i18n/locale-context";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { locale, isRTL, t } = useLocale();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setSuccess(null);
    if (!EMAIL_PATTERN.test(email.trim()) || email.trim().length > 254) {
      setError(locale === "ar" ? "أدخل بريدًا إلكترونيًا صالحًا." : "Enter a valid email address.");
      return;
    }
    setIsSubmitting(true);
    try {
      await requestPasswordResetMobile(email.trim().toLowerCase(), locale);
      setSuccess(t("resetRequestSuccess"));
      setEmail("");
    } catch (caught) {
      setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <NativeSiteHeader />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <View pointerEvents="none" style={styles.goldGlow} />
            <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{t("resetPasswordTitle")}</Text>
            <Text style={[styles.body, isRTL && styles.rtlText]}>{t("resetPasswordBody")}</Text>
            <View style={styles.field}>
              <Text style={[styles.label, isRTL && styles.rtlText]}>{t("email")}</Text>
              <TextInput
                accessibilityLabel={t("email")}
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={!isSubmitting}
                inputMode="email"
                maxLength={254}
                onChangeText={setEmail}
                onSubmitEditing={() => void submit()}
                placeholder={t("emailPlaceholder")}
                placeholderTextColor="#6B7280"
                returnKeyType="send"
                selectionColor={colors.gold}
                style={[styles.input, isRTL && styles.inputRtl]}
                textContentType="emailAddress"
                value={email}
              />
            </View>
            {error ? <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{error}</Text> : null}
            {success ? <Text accessibilityRole="alert" style={[styles.success, isRTL && styles.rtlText]}>{success}</Text> : null}
            <GoldButton loading={isSubmitting} onPress={() => void submit()}>{t("sendResetLink")}</GoldButton>
            <Pressable
              accessibilityRole="link"
              disabled={isSubmitting}
              onPress={() => router.replace("/(public)/login")}
              style={({ pressed }) => [styles.backLink, pressed && styles.pressed]}
            >
              <Text style={styles.backLinkText}>{isRTL ? "→" : "←"}  {t("backToLogin")}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "transparent", flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center", padding: spacing.lg, paddingBottom: 48 },
  card: { backgroundColor: "rgba(7,7,7,0.97)", borderColor: "rgba(255,255,255,0.10)", borderRadius: 28, borderWidth: 1, gap: spacing.lg, overflow: "hidden", padding: spacing.xl },
  goldGlow: { backgroundColor: "rgba(201,162,39,0.08)", borderRadius: 180, height: 360, left: -80, position: "absolute", top: -260, width: 360 },
  title: { color: colors.text, fontSize: 34, fontWeight: "700", letterSpacing: -0.6 },
  body: { color: colors.textMuted, fontSize: typography.small, lineHeight: 24 },
  field: { gap: spacing.sm },
  label: { color: colors.textMuted, fontSize: 11, fontWeight: "800", letterSpacing: 1.3, textTransform: "uppercase" },
  input: { backgroundColor: "rgba(0,0,0,0.30)", borderColor: "rgba(255,255,255,0.15)", borderRadius: radius.md, borderWidth: 1, color: colors.text, fontSize: typography.body, minHeight: 52, paddingHorizontal: spacing.lg },
  inputRtl: { textAlign: "right", writingDirection: "rtl" },
  error: { backgroundColor: "rgba(244,63,94,0.10)", borderColor: "rgba(244,63,94,0.25)", borderRadius: radius.md, borderWidth: 1, color: "#FECDD3", fontSize: typography.small, lineHeight: 20, padding: spacing.md },
  success: { backgroundColor: "rgba(16,185,129,0.10)", borderColor: "rgba(16,185,129,0.25)", borderRadius: radius.md, borderWidth: 1, color: "#A7F3D0", fontSize: typography.small, lineHeight: 20, padding: spacing.md },
  backLink: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  backLinkText: { color: colors.gold, fontSize: typography.small, fontWeight: "700" },
  pressed: { opacity: 0.72 },
  rtlText: { letterSpacing: 0, textAlign: "right", writingDirection: "rtl" },
});
