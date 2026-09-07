import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { NativeContactForm } from "../src/components/native-contact-form";
import { NativePageShell } from "../src/components/native-page-shell";
import { useLocale } from "../src/i18n/locale-context";

export default function ContactScreen() {
  const { locale, isRTL } = useLocale();
  const isAr = locale === "ar";
  return (
    <NativePageShell
      title={isAr ? "تواصل معنا" : "Contact"}
      subtitle={isAr ? "تواصل مع فريق Alpha Traders مباشرة من التطبيق." : "Reach the Alpha Traders team directly from the app."}
    >
      <View style={styles.card}>
        <Text style={[styles.title, isRTL && styles.rtlText]}>{isAr ? "كيف يمكننا مساعدتك؟" : "How can we help?"}</Text>
        <Text style={[styles.body, isRTL && styles.rtlText]}>
          {isAr
            ? "أرسل سؤالًا عن الأكاديمية أو حسابك أو Alpha Exchange. لمشكلة في صفقة نشطة، احتفظ بكل الأدلة داخل غرفة التداول وافتح نزاعًا عند الحاجة."
            : "Send a question about the Academy, your account, or Alpha Exchange. For an active-trade issue, preserve all evidence in the Trade Room and open a dispute when needed."}
        </Text>
        <Text selectable style={[styles.email, isRTL && styles.rtlText]}>support@alphatraders.co.il</Text>
      </View>
      <NativeContactForm />
    </NativePageShell>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.borderGold, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  title: { color: colors.text, fontSize: typography.section, fontWeight: "900" },
  body: { color: colors.textMuted, fontSize: typography.small, lineHeight: 23 },
  email: { color: colors.goldBright, fontSize: typography.body, fontWeight: "900" },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
});
