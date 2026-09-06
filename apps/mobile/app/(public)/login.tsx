import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { MobileApiError } from "../../src/api/mobile-api";
import { useAuth } from "../../src/auth/auth-context";
import { BrandMark } from "../../src/components/brand-mark";
import { GoldButton } from "../../src/components/gold-button";
import { useLocale } from "../../src/i18n/locale-context";
import {
  trustedWebUrl,
  type TrustedWebDestination,
} from "../../src/navigation/trusted-web-links";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ listingId?: string | string[]; tradeMode?: string | string[] }>();
  const { login, status, isBusy } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listingId = Array.isArray(params.listingId) ? params.listingId[0] : params.listingId;
  const rawTradeMode = Array.isArray(params.tradeMode) ? params.tradeMode[0] : params.tradeMode;
  const tradeMode = rawTradeMode === "offer" ? "offer" : "buy";
  const hasTradeDestination = typeof listingId === "string"
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(listingId);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (hasTradeDestination) {
      router.replace({
        pathname: "/trade/new/[listingId]",
        params: { listingId, mode: tradeMode },
      });
      return;
    }
    router.replace("/(tabs)");
  }, [hasTradeDestination, listingId, router, status, tradeMode]);

  async function submit() {
    setError(null);
    if (!EMAIL_PATTERN.test(email.trim()) || password.length < 8) {
      setError(t("invalidFields"));
      return;
    }
    try {
      await login(email, password);
    } catch (caught) {
      setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
    }
  }

  async function openWebsite(destination: TrustedWebDestination) {
    try {
      await Linking.openURL(trustedWebUrl(destination, locale));
    } catch {
      Alert.alert(t("genericError"), t("websiteUnavailable"));
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <BrandMark compact />
          <View style={styles.heading}>
            <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{t("loginTitle")}</Text>
            <Text style={[styles.body, isRTL && styles.rtlText]}>{t("loginBody")}</Text>
          </View>
          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={[styles.label, isRTL && styles.rtlText]}>{t("email")}</Text>
              <TextInput
                accessibilityLabel={t("email")}
                autoCapitalize="none"
                autoComplete="email"
                editable={!isBusy}
                inputMode="email"
                onChangeText={setEmail}
                placeholder={t("emailPlaceholder")}
                placeholderTextColor={colors.textMuted}
                returnKeyType="next"
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
                onChangeText={setPassword}
                onSubmitEditing={() => void submit()}
                placeholder={t("passwordPlaceholder")}
                placeholderTextColor={colors.textMuted}
                returnKeyType="go"
                secureTextEntry
                style={[styles.input, isRTL && styles.inputRtl]}
                textContentType="password"
                value={password}
              />
            </View>
            {error ? (
              <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>
                {error}
              </Text>
            ) : null}
            <GoldButton loading={isBusy} onPress={() => void submit()}>{t("signIn")}</GoldButton>
            <GoldButton
              disabled={isBusy}
              onPress={() => router.replace("/(public)/marketplace")}
              variant="ghost"
            >
              {t("browseMarket")}
            </GoldButton>
            <View style={[styles.accountLinks, isRTL && styles.rowReverse]}>
              <Pressable
                accessibilityRole="link"
                disabled={isBusy}
                hitSlop={8}
                onPress={() => void openWebsite("forgotPassword")}
              >
                <Text style={styles.link}>{t("forgotPassword")}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="link"
                disabled={isBusy}
                hitSlop={8}
                onPress={() => void openWebsite("support")}
              >
                <Text style={styles.link}>{t("requestBetaAccess")}</Text>
              </Pressable>
            </View>
          </View>
          <Text style={[styles.secure, isRTL && styles.rtlText]}>◈ {t("secureSession")}</Text>
          <View style={[styles.legalLinks, isRTL && styles.rowReverse]}>
            <Pressable accessibilityRole="link" hitSlop={8} onPress={() => void openWebsite("privacyPolicy")}>
              <Text style={styles.legalLink}>{t("privacyPolicy")}</Text>
            </Pressable>
            <Text style={styles.legalSeparator}>·</Text>
            <Pressable accessibilityRole="link" hitSlop={8} onPress={() => void openWebsite("terms")}>
              <Text style={styles.legalLink}>{t("termsOfService")}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    gap: spacing.xl,
    justifyContent: "center",
    padding: spacing.xl,
  },
  heading: {
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: "900",
  },
  body: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 24,
  },
  form: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  field: {
    gap: spacing.sm,
  },
  label: {
    color: colors.text,
    fontSize: typography.small,
    fontWeight: "700",
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: typography.body,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  inputRtl: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  error: {
    color: colors.danger,
    fontSize: typography.small,
    lineHeight: 20,
  },
  secure: {
    color: colors.goldMuted,
    fontSize: typography.small,
    textAlign: "center",
  },
  accountLinks: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    justifyContent: "space-between",
  },
  link: {
    color: colors.goldBright,
    fontSize: typography.small,
    fontWeight: "800",
    textDecorationLine: "underline",
  },
  legalLinks: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "center",
  },
  legalLink: {
    color: colors.textMuted,
    fontSize: typography.caption,
    textDecorationLine: "underline",
  },
  legalSeparator: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  rowReverse: {
    flexDirection: "row-reverse",
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
