import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getCurrentSessionUserForAuthorization } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import { buildPageMetadata } from "@/lib/seo";
import { readLearningInterests, type LearningInterest } from "@/lib/learning-interest-store";
import { LEARNING_CAMPAIGN_LINKS, learningCampaignLink, learningCampaignUrl } from "@/lib/learning-campaign";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({ locale: locale === "ar" ? "ar" : "en", path: "/admin/learning-interest",
    title: locale === "ar" ? "طلبات التعلّم مع مارك" : "Learning with Mark Enquiries",
    description: locale === "ar" ? "طلبات اهتمام خاصة بالمالك." : "Private owner learning enquiries." });
}

export default async function LearningInterestInbox({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const language = locale === "ar" ? "ar" : "en";
  const isAr = language === "ar";
  const user = await getCurrentSessionUserForAuthorization();
  if (!user) redirect(`/${language}/login?redirectTo=${encodeURIComponent(`/${language}/admin/learning-interest`)}`);
  if (user.disabled || !hasRole(user, "owner")) redirect(`/${language}/usdt-exchange`);

  let rows: LearningInterest[] = [];
  let unavailable = false;
  try { rows = await readLearningInterests(); } catch { unavailable = true; }

  return <section className="section-container page-shell">
    <div className="mx-auto max-w-4xl space-y-6">
      <p className="section-label">{isAr ? "خاص بالمالك" : "Owner only"}</p>
      <h1 className="page-title">{isAr ? "المهتمون بالتعلّم مع مارك" : "Learning with Mark Enquiries"}</h1>
      <p className="page-subtitle">{isAr ? "هذه طلبات اهتمام، وليست حجوزات أو طلابًا مؤكّدين. البريد مُدخل من صاحب الطلب ولم يُتحقق منه. يُعرض أحدث طلب لكل بريد، مع استبعاد الرسائل المصنفة مزعجة." : "These are interest enquiries, not confirmed bookings or students. Email addresses are self-reported and unverified. The latest enquiry per email is shown, excluding messages marked as spam."}</p>
      <div className="flex flex-wrap gap-4 text-sm text-[#C9A227]">
        <Link href="/admin/alpha-exchange" className="underline underline-offset-4">{isAr ? "لوحة المالك" : "Owner Dashboard"}</Link>
        <Link href="/learn-with-mark" className="underline underline-offset-4">{isAr ? "صفحة الاهتمام العامة" : "Public Interest Page"}</Link>
        <a href={`/${language}/admin/learning-interest`} className="underline underline-offset-4">{isAr ? "تحديث القائمة" : "Refresh List"}</a>
      </div>
      <details className="rounded-2xl border border-white/10 p-5">
        <summary className="cursor-pointer font-semibold">{isAr ? "روابط الحملة الجاهزة" : "Ready Campaign Links"}</summary>
        <p className="mt-3 text-sm leading-7 text-[#D1D5DB]">{isAr ? "المصدر هو آخر رابط حملة معروف في نفس علامة تبويب المتصفح خلال 30 دقيقة. لا يثبت هوية الشخص أو مصدرًا معتمدًا من منصة الإعلان. غير معروف يعني أن الرمز لم يصل أو لم يُجمع؛ لا يعني زيارة مباشرة. الروابط لا تنشر شيئًا تلقائيًا." : "Source means the last recognised campaign link in the same browser tab within 30 minutes. It does not verify identity or ad-platform attribution. Unknown means no code was captured, not necessarily a direct visit. These links do not publish anything automatically."}</p>
        <ul className="mt-4 space-y-3 text-sm">{LEARNING_CAMPAIGN_LINKS.map(link => <li key={link.id}>
          <span dir="ltr" className="font-semibold">{link.source} · {link.medium} · {link.content}</span>
          <p dir="ltr" className="mt-1 break-all select-all text-[#C9A227]">{learningCampaignUrl(link)}</p>
        </li>)}</ul>
      </details>
      {unavailable ? <p role="alert" className="rounded-2xl border border-red-500/30 p-5">{isAr ? "تعذّر تحميل الطلبات الآن. أعد تحميل الصفحة؛ هذا لا يعني أن القائمة فارغة." : "Enquiries could not be loaded. Reload this page; this does not mean the list is empty."}</p> : <>
        <p className="text-sm text-[#D1D5DB]">{isAr ? `عدد عناوين البريد المختلفة: ${rows[0]?.total ?? 0}. تظهر أحدث 100 نتيجة كحد أقصى.` : `Distinct email addresses: ${rows[0]?.total ?? 0}. Up to the latest 100 entries are shown.`}</p>
        {rows.length === 0 ? <p>{isAr ? "لا توجد طلبات اهتمام محفوظة بعد." : "No saved learning enquiries yet."}</p> : rows.map(row => {
          const campaign = learningCampaignLink(row.campaign_link_id);
          return <article key={row.id} className="space-y-3 rounded-2xl border border-white/10 bg-[#0B0B0B]/90 p-5">
          <h2 className="break-words text-lg font-semibold">{row.name}</h2>
          <p className="break-all text-sm"><span dir="ltr">{row.email}</span></p>
          <p className="text-xs text-[#D1D5DB]">{new Date(row.created_at).toLocaleString(isAr ? "ar-IL" : "en-GB", { timeZone: "Asia/Jerusalem" })} · {isAr ? "بتوقيت إسرائيل" : "Israel time"}</p>
          <p className="text-xs text-[#C9A227]">{isAr ? "رابط الحملة: " : "Campaign link: "}{campaign ? <span dir="ltr">{campaign.source} · {campaign.medium} · {campaign.content}</span> : (isAr ? "غير معروف" : "Unknown")}</p>
          <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[#D1D5DB]">{row.message}</p>
        </article>; })}
      </>}
    </div>
  </section>;
}
