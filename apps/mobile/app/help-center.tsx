import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { GoldButton } from "../src/components/gold-button";
import { NativeInformationCard, NativeInformationText } from "../src/components/native-information-card";
import { NativePageShell } from "../src/components/native-page-shell";
import { useLocale } from "../src/i18n/locale-context";

export default function HelpCenterScreen() {
  const router = useRouter();
  const { locale, isRTL } = useLocale();
  const isAr = locale === "ar";
  const guides = isAr ? [
    "ابدأ داخل التطبيق الرسمي، أنشئ حسابك، ثم راجع العروض المعتمدة وإشارات البائع الحالية.",
    "داخل غرفة التداول، أكد المبلغ ووسيلة الدفع وشبكة USDT وعنوان المحفظة وارفع الأدلة المطلوبة في وقتها.",
    "يدفع المشتري للبائع مباشرة؛ يتحقق البائع من استلام الأموال ثم يرسل USDT إلى محفظة المشتري المؤكدة.",
    "لا تنقل الصفقة إلى Discord أو WhatsApp أو الرسائل الخاصة، ولا ترسل كلمات مرور أو رموز استرداد.",
  ] : [
    "Start inside the official app, create your account, then review approved listings and each seller's current signals.",
    "Inside the Trade Room, confirm the amount, payment method, USDT network, and wallet address, and upload required evidence on time.",
    "The buyer pays the seller directly; the seller verifies receipt and then sends USDT to the buyer's confirmed wallet.",
    "Do not move a trade to Discord, WhatsApp, or private messages, and never send passwords or recovery codes.",
  ];
  const faqs = isAr ? [
    ["هل صفقة Alpha Exchange مضمونة؟", "لا. ضوابط المنصة تقلل المخاطر وتحسن إمكانية مراجعة الصفقة، لكنها لا تلغي كل مخاطر الدفع أو الطرف المقابل أو البلوكشين."],
    ["ماذا يعني بائع معتمد؟", "يعني أن Alpha Traders راجعت الطلب وسمحت للبائع بنشر العروض. لا يعني ضمان الهوية أو السلوك المستقبلي أو نجاح كل صفقة."],
    ["ماذا أفعل عند وجود مشكلة؟", "توقف قبل إرسال أو تحرير القيمة، احتفظ بالأدلة داخل الصفقة، افتح نزاعًا أو بلاغًا، وتواصل مع الدعم الرسمي."],
  ] : [
    ["Is an Alpha Exchange trade guaranteed?", "No. Platform controls reduce risk and improve reviewability, but they cannot eliminate every payment, counterparty, or blockchain risk."],
    ["What does Approved Seller mean?", "Alpha Traders reviewed the application and allowed that seller to publish listings. It does not guarantee identity, future conduct, or every trade outcome."],
    ["What should I do when there is a problem?", "Stop before sending or releasing value, preserve evidence inside the trade, open a dispute or report, and contact official support."],
  ];
  return (
    <NativePageShell
      title={isAr ? "مركز المساعدة" : "Help Center"}
      subtitle={isAr ? "المسار الرسمي من فتح الطلب حتى إكمال الصفقة." : "The official workflow from opening a request through trade completion."}
    >
      <View style={styles.steps}>
        {guides.map((guide, index) => (
          <View key={guide} style={styles.step}>
            <Text style={styles.stepLabel}>{isAr ? `الخطوة ${index + 1}` : `STEP ${index + 1}`}</Text>
            <Text style={[styles.body, isRTL && styles.rtlText]}>{guide}</Text>
          </View>
        ))}
      </View>
      <NativeInformationCard title={isAr ? "الأسئلة الشائعة" : "Frequently Asked Questions"} tone="gold">
        {faqs.map(([question, answer]) => (
          <View key={question} style={styles.faq}>
            <Text style={[styles.faqTitle, isRTL && styles.rtlText]}>{question}</Text>
            <NativeInformationText>{answer}</NativeInformationText>
          </View>
        ))}
      </NativeInformationCard>
      <GoldButton onPress={() => router.push("/safety-trust")}>{isAr ? "قراءة دليل الأمان الكامل" : "Read the complete safety guide"}</GoldButton>
      <GoldButton onPress={() => router.push("/report-abuse")} variant="outline">{isAr ? "فتح بلاغ" : "Open a report"}</GoldButton>
      <GoldButton onPress={() => router.push("/support")} variant="ghost">{isAr ? "التواصل مع الدعم" : "Contact support"}</GoldButton>
    </NativePageShell>
  );
}

const styles = StyleSheet.create({
  steps: { gap: spacing.md },
  step: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.lg },
  stepLabel: { color: colors.gold, fontSize: typography.caption, fontWeight: "900", letterSpacing: 1.3 },
  body: { color: "#D1D5DB", fontSize: typography.small, lineHeight: 23 },
  faq: { borderTopColor: colors.border, borderTopWidth: 1, gap: spacing.sm, paddingTop: spacing.md },
  faqTitle: { color: colors.text, fontSize: typography.small, fontWeight: "900", lineHeight: 21 },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
});
