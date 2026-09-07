import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { NativeContactForm } from "../src/components/native-contact-form";
import { NativePageShell } from "../src/components/native-page-shell";
import { useLocale } from "../src/i18n/locale-context";

export default function SupportScreen() {
  const { locale, isRTL } = useLocale();
  const isAr = locale === "ar";
  return (
    <NativePageShell
      title={isAr ? "الدعم" : "Support"}
      subtitle={isAr ? "مساعدة الحساب والتسجيل والصفقات، مباشرة من التطبيق." : "Account, onboarding, and trade help—directly inside the app."}
    >
      <View style={styles.card}>
        <Text style={[styles.body, isRTL && styles.rtlText]}>
          {isAr
            ? "للمساعدة في الحساب، التسجيل، أو مشاكل التداول، تواصل مع دعم Alpha Traders."
            : "For account, onboarding, or trade support, contact Alpha Traders support."}
        </Text>
        <Text selectable style={[styles.email, isRTL && styles.rtlText]}>support@alphatraders.co.il</Text>
        <Text style={[styles.note, isRTL && styles.rtlText]}>
          {isAr ? "استخدم النموذج لإرسال تفاصيل المشكلة كاملة." : "Use the form below to submit the full issue details."}
        </Text>
      </View>
      <NativeContactForm />
    </NativePageShell>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.borderGold,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  body: {
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 25,
  },
  email: {
    color: colors.goldBright,
    fontSize: typography.body,
    fontWeight: "900",
  },
  note: {
    color: colors.textMuted,
    fontSize: typography.small,
    lineHeight: 21,
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
