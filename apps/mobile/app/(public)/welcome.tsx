import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { BrandMark } from "../../src/components/brand-mark";
import { GoldButton } from "../../src/components/gold-button";
import { LanguageSwitch } from "../../src/components/language-switch";
import { useLocale } from "../../src/i18n/locale-context";

export default function WelcomeScreen() {
  const router = useRouter();
  const { isRTL, t } = useLocale();
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View pointerEvents="none" style={styles.goldGlow} />
        <BrandMark />
        <View style={styles.hero}>
          <Text style={[styles.eyebrow, isRTL && styles.rtlText]}>{t("welcomeEyebrow")}</Text>
          <Text style={[styles.title, isRTL && styles.rtlText]}>{t("welcomeTitle")}</Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>{t("welcomeBody")}</Text>
        </View>
        <View style={styles.languageCard}>
          <Text style={[styles.languageTitle, isRTL && styles.rtlText]}>{t("chooseLanguage")}</Text>
          <LanguageSwitch />
        </View>
        <View style={styles.actions}>
          <GoldButton onPress={() => router.push("/(public)/marketplace")}>{t("browseMarket")}</GoldButton>
          <GoldButton onPress={() => router.push("/(public)/login")} variant="outline">{t("signIn")}</GoldButton>
        </View>
        <Text style={[styles.foundation, isRTL && styles.rtlText]}>{t("appFoundation")}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    gap: spacing.xl,
    justifyContent: "center",
    overflow: "hidden",
    padding: spacing.xl,
  },
  goldGlow: {
    backgroundColor: "rgba(216, 180, 74, 0.10)",
    borderRadius: 190,
    height: 380,
    position: "absolute",
    right: -190,
    top: -140,
    width: 380,
  },
  hero: {
    gap: spacing.md,
    marginVertical: spacing.lg,
  },
  eyebrow: {
    color: colors.gold,
    fontSize: typography.caption,
    fontWeight: "900",
    letterSpacing: 2,
  },
  title: {
    color: colors.text,
    fontSize: typography.hero,
    fontWeight: "900",
    letterSpacing: -1,
    lineHeight: 41,
  },
  body: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 25,
    maxWidth: 520,
  },
  languageCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  languageTitle: {
    color: colors.text,
    fontSize: typography.small,
    fontWeight: "800",
  },
  actions: {
    gap: spacing.md,
  },
  foundation: {
    color: colors.goldMuted,
    fontSize: typography.caption,
    textAlign: "center",
  },
  rtlText: {
    letterSpacing: 0,
    textAlign: "right",
    writingDirection: "rtl",
  },
});
