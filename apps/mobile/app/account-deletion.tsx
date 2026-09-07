import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { NativeContactForm } from "../src/components/native-contact-form";
import { NativePageShell } from "../src/components/native-page-shell";
import { useLocale } from "../src/i18n/locale-context";

export default function AccountDeletionScreen() {
  const { locale, isRTL } = useLocale();
  const isAr = locale === "ar";
  const steps = isAr ? [
    "أرسل النموذج باستخدام البريد الإلكتروني المسجل في حسابك.",
    "سيتحقق فريق الدعم من ملكية الحساب وقد يطلب تأكيدًا إضافيًا عبر البريد الإلكتروني.",
    "نؤكد استلام الطلب ونكمل الحذف عادةً خلال 30 يومًا.",
  ] : [
    "Submit the form using the email address registered to your account.",
    "Support will verify account ownership and may request an additional email confirmation.",
    "We acknowledge the request and normally complete deletion within 30 days.",
  ];
  const subject = isAr ? "طلب حذف حساب Alpha Traders" : "Alpha Traders account deletion request";
  const message = isAr
    ? "أطلب حذف حساب Alpha Traders المرتبط بالبريد الإلكتروني المذكور أعلاه والبيانات المرتبطة به."
    : "I request deletion of the Alpha Traders account registered to the email address above and its associated data.";

  return (
    <NativePageShell
      title={isAr ? "طلب حذف الحساب" : "Request account deletion"}
      subtitle={isAr ? "ابدأ طلب حذف حسابك وبياناتك المرتبطة." : "Start deletion of your account and associated personal data."}
    >
      <View style={styles.card}>
        <Text style={[styles.body, isRTL && styles.rtlText]}>
          {isAr
            ? "يمكنك بدء حذف حساب Alpha Traders والبيانات الشخصية المرتبطة به من داخل التطبيق."
            : "You can start deletion of your Alpha Traders account and associated personal data directly inside the app."}
        </Text>
        {steps.map((step, index) => (
          <View key={step} style={[styles.step, isRTL && styles.rowReverse]}>
            <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View>
            <Text style={[styles.stepText, isRTL && styles.rtlText]}>{step}</Text>
          </View>
        ))}
        <Text style={[styles.body, isRTL && styles.rtlText]}>
          {isAr
            ? "سيُحذف الحساب والبيانات غير المطلوبة قانونيًا. قد نحتفظ بسجلات محدودة للنزاعات أو منع الاحتيال أو الأمان أو الالتزامات القانونية. يجب أولًا تسوية الصفقات أو النزاعات النشطة."
            : "The account and data not legally required will be deleted. Limited records may be retained for disputes, fraud prevention, security, or legal obligations. Active trades or disputes must be resolved first."}
        </Text>
        <View style={styles.warning}>
          <Text style={[styles.warningText, isRTL && styles.rtlText]}>
            {isAr
              ? "لا ترسل كلمة المرور أو عبارة استرداد المحفظة أو المفاتيح الخاصة أو أدلة الدفع في هذا النموذج."
              : "Never include your password, wallet recovery phrase, private keys, or payment evidence in this form."}
          </Text>
        </View>
      </View>
      <NativeContactForm
        initialMessage={message}
        initialSubject={subject}
        successMessage={isAr ? "سيتحقق فريق الدعم من ملكية الحساب ويتواصل معك عبر البريد." : "Support will verify account ownership and contact you by email."}
      />
    </NativePageShell>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  body: {
    color: colors.textMuted,
    fontSize: typography.small,
    lineHeight: 23,
  },
  step: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
  },
  stepNumber: {
    alignItems: "center",
    backgroundColor: colors.gold,
    borderRadius: radius.pill,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  stepNumberText: {
    color: colors.background,
    fontSize: typography.small,
    fontWeight: "900",
  },
  stepText: {
    color: colors.text,
    flex: 1,
    fontSize: typography.small,
    lineHeight: 22,
  },
  warning: {
    backgroundColor: "rgba(245,158,11,0.07)",
    borderColor: colors.warning,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  warningText: {
    color: colors.warning,
    fontSize: typography.small,
    fontWeight: "700",
    lineHeight: 21,
  },
  rowReverse: {
    flexDirection: "row-reverse",
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
