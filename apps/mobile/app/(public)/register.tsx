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
import { MobileApiError, registerMobile } from "../../src/api/mobile-api";
import { GoldButton } from "../../src/components/gold-button";
import { NativeSiteHeader } from "../../src/components/native-site-header";
import { useLocale } from "../../src/i18n/locale-context";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterScreen() {
  const router = useRouter();
  const { locale, isRTL, t } = useLocale();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setSuccess(null);
    const valid = fullName.trim().length > 0
      && fullName.trim().length <= 100
      && EMAIL_PATTERN.test(email.trim())
      && email.trim().length <= 254
      && password.length >= 8
      && password.length <= 256
      && password === confirmPassword
      && whatsappNumber.trim().length <= 30
      && agreedToTerms;
    if (!valid) {
      setError(t("registrationInvalid"));
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await registerMobile({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
        confirmPassword,
        whatsappNumber: whatsappNumber.trim(),
        agreedToTerms,
      }, locale);
      setSuccess(response.message ?? t("registrationSuccess"));
      setFullName("");
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      setWhatsappNumber("");
      setAgreedToTerms(false);
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
            <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{t("registerTitle")}</Text>
            <Text style={[styles.body, isRTL && styles.rtlText]}>{t("registerBody")}</Text>

            <View style={styles.form}>
              <AuthField
                autoComplete="name"
                editable={!isSubmitting}
                isRTL={isRTL}
                label={t("fullName")}
                maxLength={100}
                onChangeText={setFullName}
                textContentType="name"
                value={fullName}
              />
              <AuthField
                autoCapitalize="none"
                autoComplete="email"
                editable={!isSubmitting}
                inputMode="email"
                isRTL={isRTL}
                label={t("email")}
                maxLength={254}
                onChangeText={setEmail}
                textContentType="emailAddress"
                value={email}
              />
              <AuthField
                autoCapitalize="none"
                autoComplete="new-password"
                editable={!isSubmitting}
                isRTL={isRTL}
                label={t("password")}
                maxLength={256}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="newPassword"
                value={password}
              />
              <AuthField
                autoCapitalize="none"
                autoComplete="new-password"
                editable={!isSubmitting}
                isRTL={isRTL}
                label={t("confirmPassword")}
                maxLength={256}
                onChangeText={setConfirmPassword}
                onSubmitEditing={() => void submit()}
                returnKeyType="go"
                secureTextEntry
                textContentType="newPassword"
                value={confirmPassword}
              />
              <AuthField
                autoComplete="tel"
                editable={!isSubmitting}
                inputMode="tel"
                isRTL={isRTL}
                label={t("whatsappOptional")}
                maxLength={30}
                onChangeText={setWhatsappNumber}
                textContentType="telephoneNumber"
                value={whatsappNumber}
              />

              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: agreedToTerms }}
                disabled={isSubmitting}
                onPress={() => setAgreedToTerms((value) => !value)}
                style={({ pressed }) => [styles.checkboxRow, isRTL && styles.rowReverse, pressed && styles.pressed]}
              >
                <View style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}>
                  <Text style={styles.checkmark}>{agreedToTerms ? "✓" : ""}</Text>
                </View>
                <Text style={[styles.checkboxLabel, isRTL && styles.rtlText]}>{t("agreeTerms")}</Text>
              </Pressable>

              {error ? <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{error}</Text> : null}
              {success ? <Text accessibilityRole="alert" style={[styles.success, isRTL && styles.rtlText]}>{success}</Text> : null}
              <GoldButton loading={isSubmitting} onPress={() => void submit()}>{t("createAccount")}</GoldButton>
            </View>

            <View style={[styles.loginRow, isRTL && styles.rowReverse]}>
              <Text style={styles.accountPrompt}>{t("alreadyHaveAccount")}</Text>
              <Pressable
                accessibilityRole="link"
                disabled={isSubmitting}
                onPress={() => router.replace("/(public)/login")}
                style={({ pressed }) => [styles.linkTarget, pressed && styles.pressed]}
              >
                <Text style={styles.link}>{t("websiteLoginTitle")}</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type AuthFieldProps = React.ComponentProps<typeof TextInput> & {
  label: string;
  isRTL: boolean;
};

function AuthField({ label, isRTL, style, ...props }: AuthFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, isRTL && styles.rtlText]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCorrect={false}
        placeholder={label}
        placeholderTextColor="#6B7280"
        selectionColor={colors.gold}
        style={[styles.input, isRTL && styles.inputRtl, style]}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "transparent", flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.lg, paddingBottom: 48 },
  card: {
    backgroundColor: "rgba(7,7,7,0.97)",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 28,
    borderWidth: 1,
    gap: spacing.lg,
    overflow: "hidden",
    padding: spacing.xl,
  },
  goldGlow: { backgroundColor: "rgba(201,162,39,0.08)", borderRadius: 180, height: 360, left: -80, position: "absolute", top: -260, width: 360 },
  title: { color: colors.text, fontSize: 34, fontWeight: "700", letterSpacing: -0.6 },
  body: { color: colors.textMuted, fontSize: typography.small, lineHeight: 24 },
  form: { gap: spacing.lg },
  field: { gap: spacing.sm },
  label: { color: colors.textMuted, fontSize: 11, fontWeight: "800", letterSpacing: 1.3, textTransform: "uppercase" },
  input: { backgroundColor: "rgba(0,0,0,0.30)", borderColor: "rgba(255,255,255,0.15)", borderRadius: radius.md, borderWidth: 1, color: colors.text, fontSize: typography.body, minHeight: 52, paddingHorizontal: spacing.lg },
  inputRtl: { textAlign: "right", writingDirection: "rtl" },
  checkboxRow: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm, minHeight: 44 },
  checkbox: { alignItems: "center", borderColor: "rgba(255,255,255,0.30)", borderRadius: 5, borderWidth: 1, height: 22, justifyContent: "center", marginTop: 1, width: 22 },
  checkboxChecked: { backgroundColor: colors.gold, borderColor: colors.gold },
  checkmark: { color: colors.background, fontSize: typography.small, fontWeight: "900" },
  checkboxLabel: { color: "#D1D5DB", flex: 1, fontSize: typography.small, lineHeight: 21 },
  error: { backgroundColor: "rgba(244,63,94,0.10)", borderColor: "rgba(244,63,94,0.25)", borderRadius: radius.md, borderWidth: 1, color: "#FECDD3", fontSize: typography.small, lineHeight: 20, padding: spacing.md },
  success: { backgroundColor: "rgba(16,185,129,0.10)", borderColor: "rgba(16,185,129,0.25)", borderRadius: radius.md, borderWidth: 1, color: "#A7F3D0", fontSize: typography.small, lineHeight: 20, padding: spacing.md },
  loginRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  accountPrompt: { color: colors.textMuted, fontSize: typography.small },
  linkTarget: { justifyContent: "center", minHeight: 44 },
  link: { color: colors.gold, fontSize: typography.small, fontWeight: "700" },
  pressed: { opacity: 0.72 },
  rowReverse: { flexDirection: "row-reverse" },
  rtlText: { letterSpacing: 0, textAlign: "right", writingDirection: "rtl" },
});
