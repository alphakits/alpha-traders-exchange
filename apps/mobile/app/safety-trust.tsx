import { useRouter } from "expo-router";
import { GoldButton } from "../src/components/gold-button";
import { NativeBulletList, NativeInformationCard, NativeInformationText } from "../src/components/native-information-card";
import { NativePageShell } from "../src/components/native-page-shell";
import { useLocale } from "../src/i18n/locale-context";

export default function SafetyTrustScreen() {
  const router = useRouter();
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const controls = isAr ? [
    "يمكن فقط للبائعين الذين وافقت عليهم Alpha Traders يدويًا نشر عروض السوق.",
    "تظهر إشارات البائع وحدود الصفقة ووسائل الدفع وتفاصيل الشبكة قبل فتح الطلب.",
    "يحصل كل طلب على معرّف ثابت وسجل مراحل وأدوات أدلة وإشعارات وضوابط وقت.",
    "تظهر التفاصيل الحساسة حسب مرحلة الصفقة ودور المشارك، مع مسارات للنزاع والبلاغ.",
  ] : [
    "Only sellers manually approved by Alpha Traders can publish marketplace listings.",
    "Seller signals, trade limits, payment methods, and network details appear before a buyer opens a request.",
    "Every request receives a fixed ID, staged status history, evidence tools, notifications, and time controls.",
    "Sensitive details are disclosed by trade stage and participant role, with dispute and report paths available.",
  ];
  const limits = isAr ? [
    "البائع المعتمد هو قرار صلاحية للمنصة، وليس ضمانًا للهوية أو السلوك المستقبلي أو الربح.",
    "لا تستطيع Alpha Traders إلغاء مخاطر الاحتيال أو عكس الدفعات أو أخطاء المحفظة أو البلوكشين.",
    "محتوى الأكاديمية تعليمي وليس نصيحة مالية أو قانونية أو ضريبية شخصية ولا يعد بعوائد.",
    "الشعار أو الحساب الاجتماعي أو الرسالة الخاصة أو وثيقة الهوية لا تثبت بمفردها ترخيصًا ماليًا.",
  ] : [
    "Approved Seller is a platform-access decision, not a guarantee of identity, future conduct, profit, or success.",
    "Alpha Traders cannot eliminate fraud, payment reversals, counterparty mistakes, wallet errors, or blockchain risk.",
    "Academy content is educational, not personalized financial, legal, or tax advice, and it does not promise returns.",
    "A logo, social profile, private message, or identity document is not by itself proof of a financial-services licence.",
  ];
  return (
    <NativePageShell
      title={isAr ? "مركز الأمان والثقة" : "Safety & Trust Center"}
      subtitle={isAr ? "ضوابط الأمان وحدود الحماية وطريقة تسوية صفقات Alpha Exchange." : "Alpha Exchange safety controls, protection limits, and direct trade settlement."}
    >
      <NativeInformationCard title={isAr ? "الضوابط المدمجة في Alpha Exchange" : "Controls built into Alpha Exchange"} tone="green">
        <NativeBulletList items={controls} />
      </NativeInformationCard>
      <NativeInformationCard title={isAr ? "ما الذي لا تضمنه هذه الضوابط" : "What these controls do not guarantee"} tone="warning">
        <NativeBulletList items={limits} warning />
      </NativeInformationCard>
      <NativeInformationCard title={isAr ? "كيف تتم تسوية صفقة السوق" : "How marketplace settlement works"} tone="gold">
        <NativeInformationText>
          {isAr
            ? "تنسق Alpha Traders مسار الصفقة وتسجله، لكنها لا تحتفظ بأصل الأموال. يدفع المشتري للبائع مباشرة، ويتحقق البائع من الاستلام، ثم يرسل USDT إلى محفظة المشتري وشبكته المؤكدتين. هذا ليس إسكرو احتجازيًا."
            : "Alpha Traders coordinates and records the workflow; it does not take custody of the principal funds. The buyer pays the seller directly, the seller verifies receipt, and then sends USDT to the buyer's confirmed wallet and network. This is not custodial escrow."}
        </NativeInformationText>
      </NativeInformationCard>
      <NativeInformationCard title={isAr ? "استخدم القنوات الرسمية فقط" : "Use official channels only"}>
        <NativeInformationText>
          {isAr
            ? "احتفظ بتواصل الصفقة والأدلة داخل غرفة التداول في التطبيق. Discord وWhatsApp والتواصل الاجتماعي ليست نظام الصفقات. لا ترسل أموالًا أو كلمات مرور أو وثائق هوية أو أسرار محفظة في رسالة خاصة غير مطلوبة."
            : "Keep trade communication and evidence inside the app's Trade Room. Discord, WhatsApp, and social channels are not the transaction system. Never send funds, passwords, identity documents, or wallet secrets in an unsolicited private message."}
        </NativeInformationText>
      </NativeInformationCard>
      <NativeInformationCard title={isAr ? "إذا لاحظت شيئًا غير صحيح" : "If something looks wrong"} tone="danger">
        <NativeInformationText>
          {isAr
            ? "توقف قبل إرسال أو تحرير أي قيمة. احتفظ بسجل الصفقة والأدلة، وافتح نزاعًا أو بلاغًا، وتواصل مع الدعم الرسمي."
            : "Stop before sending or releasing value. Preserve the trade record and evidence, open a dispute or report, and contact official support."}
        </NativeInformationText>
      </NativeInformationCard>
      <GoldButton onPress={() => router.push("/report-abuse")}>{isAr ? "الإبلاغ عن نشاط مريب" : "Report suspicious activity"}</GoldButton>
      <GoldButton onPress={() => router.push("/terms")} variant="outline">{isAr ? "قراءة شروط السوق" : "Read the marketplace terms"}</GoldButton>
    </NativePageShell>
  );
}
