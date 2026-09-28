import { NativeContactForm } from "../src/components/native-contact-form";
import { NativeBulletList, NativeInformationCard, NativeInformationText } from "../src/components/native-information-card";
import { NativePageShell } from "../src/components/native-page-shell";
import { useLocale } from "../src/i18n/locale-context";

export default function ReportAbuseScreen() {
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const details = isAr
    ? ["معرّف الصفقة أو العرض", "اسم المستخدم المعني", "وقت الحادثة", "وصف واضح لما حدث"]
    : ["Trade or listing ID", "The relevant username", "Incident time", "A clear description of what happened"];
  return (
    <NativePageShell
      title={isAr ? "الإبلاغ عن إساءة" : "Report Abuse"}
      subtitle={isAr ? "أبلغ عن السلوك المسيء أو النشاط المشبوه بأمان." : "Report abusive behavior or suspicious activity safely."}
    >
      <NativeInformationCard title={isAr ? "أوقف الإجراء أولًا" : "Stop the action first"} tone="danger">
        <NativeInformationText>
          {isAr
            ? "إذا بدت الصفقة أو تعليمات الدفع أو المحفظة غير صحيحة، لا ترسل أو تحرر أي قيمة. احتفظ بالسجل والأدلة داخل غرفة التداول."
            : "If a trade, payment instruction, or wallet looks wrong, do not send or release value. Preserve the record and evidence inside the Trade Room."}
        </NativeInformationText>
      </NativeInformationCard>
      <NativeInformationCard title={isAr ? "أرفق المعلومات التالية" : "Include these details"}>
        <NativeBulletList items={details} />
      </NativeInformationCard>
      <NativeContactForm
        initialSubject={isAr ? "بلاغ إساءة أو نشاط مشبوه" : "Abuse or suspicious activity report"}
        successMessage={isAr ? "استلم فريق Alpha Traders البلاغ وسيراجعه بأسرع وقت." : "The Alpha Traders team received the report and will review it promptly."}
      />
    </NativePageShell>
  );
}
