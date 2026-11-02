import Image from "next/image";
import { ArrowRight, AudioLines, BookOpen, Radio } from "lucide-react";
import { redirect } from "next/navigation";
import { MentorshipLink } from "@/components/academy/mentorship-link";
import { currencyText } from "@/components/ui/currency-text";
import { mentorshipFees, mentorshipPhase } from "@/lib/ict-mentorship-offer";
import { buildPageMetadata } from "@/lib/seo";
import styles from "./offer.module.css";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps) {
  const language = (await params).locale === "ar" ? "ar" : "en";
  return buildPageMetadata({
    locale: language, path: "/mentorship-offer",
    title: language === "ar" ? "دعوة للتعلّم مع مارك" : "Mark’s ICT mentorship invitation",
    description: language === "ar" ? "تعرّف على عرض المنتورشيب، الرسوم وطريقة التعلّم مع مارك." : "See the mentorship offer, tuition and how you’ll study with Mark.",
  });
}

export default async function MentorshipOfferPage({ params }: PageProps) {
  const locale = (await params).locale === "ar" ? "ar" : "en";
  const t = (en: string, ar: string) => locale === "ar" ? ar : en;
  const phase = mentorshipPhase();
  if (phase === "closed") redirect(`/${locale}/learn-trading-free`);
  if (phase === "standard") redirect(`/${locale}/learn-with-mark`);
  const fees = mentorshipFees(phase);

  return (
    <article className={styles.page} aria-labelledby="invitation-title">
      <div className={styles.hero}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>{t("An invitation from Mark", "دعوة من مارك")}</p>
          <h1 id="invitation-title">{t("Learn ICT with Mark", "تعلّم التداول مع مارك")}</h1>
          <p className={styles.description}>{t("Bring one of your charts to our weekly Discord session. We’ll review why you entered, where you placed your stop and how you chose your exit.", "جيب شارت من تداولاتك على لايف الديسكورد الأسبوعي. منراجع سوا ليش دخلت الصفقة، وين حطّيت الستوب وكيف قرّرت تطلع.")}</p>
          <ul className={styles.features}>
            <li><BookOpen size={15} aria-hidden="true" />{t("19+ recorded lessons", "19 درس مسجّل على الأقل")}</li>
            <li><Radio size={15} aria-hidden="true" />{t("Weekly live on Discord", "لايف أسبوعي على ديسكورد")}</li>
          </ul>
        </div>
        <Image className={styles.art} src="/images/brand/mentorship-invitation-header.webp" alt="" width={941} height={389} sizes="(max-width: 679px) 100vw, 385px" />
      </div>
      <section id="offer-details" aria-labelledby="offer-title" className={styles.offer}>
        <p className={styles.eyebrow}>{phase === "november" ? t("November 2026", "نوفمبر 2026") : t("December 2026", "ديسمبر 2026")}</p>
        <h2 id="offer-title">{phase === "november" ? t("Enrol by November 30 for 10% off", "سجّل حتى 30 نوفمبر وخد خصم 10%") : t("December is the final intake", "ديسمبر آخر شهر لقبول طلاب جدد")}</h2>
        {fees ? (
          <>
            <p className={styles.note}>{t("Your November fee depends on where you’re starting.", "هاي رسوم نوفمبر بعد الخصم، حسب نقطة بدايتك.")}</p>
            <dl className={styles.fees}>
              <div><dt>{t("You have 1–2 years in the markets", "إلك سنة أو سنتين بالسوق")}</dt><dd>{currencyText(fees.experiencedFee)}</dd></div>
              <div><dt>{t("You’re starting from zero", "بتبلّش من الصفر")}</dt><dd>{currencyText(fees.beginnerFee)}</dd></div>
            </dl>
            <p className={styles.note}>{t("December is the final intake. Tuition rises by at least 10%.", "ديسمبر آخر شهر لقبول طلاب جدد، وفيه بترتفع الرسوم بنسبة 10% على الأقل.")}</p>
          </>
        ) : <p className={styles.note}>{t("Tuition rises by at least 10% in December. Send your enquiry by December 31, Israel time. Mark will confirm your fee before you enrol.", "بترتفع الرسوم في ديسمبر بنسبة 10% على الأقل. ابعت استفسارك حتى 31 ديسمبر بتوقيت إسرائيل، ومارك بأكّد لك السعر قبل التسجيل.")}</p>}
        <div className={styles.nextStep}>
          <MentorshipLink href="/learn-with-mark" locale={locale} className={styles.cta}>
            {t("Open the full ICT mentorship", "شوف برنامج ICT Mentorship كامل")}<ArrowRight size={17} aria-hidden="true" />
          </MentorshipLink>
          <p><AudioLines size={17} aria-hidden="true" /><span>{t("Hear Mark’s ", "اسمع شرح مارك بصوته · ")}<bdi dir="ltr">7:44</bdi>{t(" introduction, explore the curriculum and ask about joining.", "، شوف المنهج وابعت استفسارك عن التسجيل.")}</span></p>
        </div>
      </section>
    </article>
  );
}
