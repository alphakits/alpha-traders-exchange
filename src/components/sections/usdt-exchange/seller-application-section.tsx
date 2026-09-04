"use client";

import type { FormEventHandler } from "react";
import { AlertTriangle, CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldLabel, requiredFieldClasses } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getOfficialOwnerWhatsAppUrl } from "@/lib/official-contact";
import type { SellerApplicationEligibility } from "@/lib/seller-application-eligibility";
import type { SellerApplication } from "@/types/alpha-exchange";

const WHATSAPP_URL = getOfficialOwnerWhatsAppUrl();

const SELLER_APPLICATION_METHOD_OPTIONS = [
  { id: "USDT (ERC20 / Ethereum)", group: "Crypto", recommended: true },
  { id: "USDT (Polygon)", group: "Crypto", recommended: false },
  { id: "USDT (Solana SPL / Phantom)", group: "Crypto", recommended: false },
  { id: "Face-to-Face", group: "Fiat", recommended: false },
  { id: "Cardless Withdrawal", group: "Fiat", recommended: false },
  { id: "Bank Transfer", group: "Fiat", recommended: false },
] as const;

export type SellerApplicationMethod = (typeof SELLER_APPLICATION_METHOD_OPTIONS)[number]["id"];

export type SellerApplicationForm = {
  firstName: string;
  lastName: string;
  email: string;
  whatsappNumber: string;
  expectedMonthlyTradingVolume: string;
  additionalNotes: string;
};

type SellerApplicationSectionProps = {
  isAr: boolean;
  prominent?: boolean;
  isLoading: boolean;
  isApprovedSellerSession: boolean;
  shouldCondense: boolean;
  isExpanded: boolean;
  eligibility: SellerApplicationEligibility;
  application: SellerApplication | null;
  statusMessage: string | null;
  form: SellerApplicationForm;
  sessionEmail: string;
  methods: SellerApplicationMethod[];
  onExpandedChange: (expanded: boolean) => void;
  onSetUpBuyer: () => void;
  onFormChange: (field: keyof SellerApplicationForm, value: string) => void;
  onMethodToggle: (method: SellerApplicationMethod) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
};

function sellerApplicationMethodLabel(method: SellerApplicationMethod, isAr: boolean) {
  if (!isAr) return method;
  if (method === "Face-to-Face") return "لقاء شخصي";
  if (method === "Cardless Withdrawal") return "سحب بلا بطاقة";
  if (method === "Bank Transfer") return "تحويل بنكي";
  return method;
}

export function SellerApplicationSection({
  isAr,
  prominent = false,
  isLoading,
  isApprovedSellerSession,
  shouldCondense,
  isExpanded,
  eligibility,
  application,
  statusMessage,
  form,
  sessionEmail,
  methods,
  onExpandedChange,
  onSetUpBuyer,
  onFormChange,
  onMethodToggle,
  onSubmit,
}: SellerApplicationSectionProps) {
  return (
    <div className={`${prominent ? "mt-5" : "mt-10"} grid gap-6 xl:grid-cols-2`}>
      <Card id="seller-application" className={prominent ? "border-[#C9A227]/45 bg-[linear-gradient(145deg,rgba(201,162,39,0.13),rgba(11,11,11,0.96)_48%)] shadow-[0_18px_65px_rgba(201,162,39,0.12)]" : "border-white/10 bg-[#0B0B0B]/90"}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#C9A227]/35 bg-[#C9A227]/10 text-[#C9A227]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">{isAr ? "انضم كبائع معتمد" : "Become an Approved Seller"}</CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                {prominent
                  ? (isAr ? "افتح مصدر دخل جديد — قدّم طلبك للوصول إلى أدوات البيع." : "Unlock a new earning path—apply for access to the seller tools.")
                  : (isAr ? "يتم مراجعة الطلبات يدويًا قبل منح صلاحية النشر." : "Applications are reviewed manually before marketplace access is granted.")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {shouldCondense && !isExpanded ? (
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]">
              <p className="text-xs uppercase tracking-[0.14em] text-[#D4AF37]">{prominent ? (isAr ? "بع USDT على Alpha Exchange" : "Sell on Alpha Exchange") : (isAr ? "خيار إضافي" : "Optional Next Step")}</p>
              <p className="mt-2 text-base font-semibold text-white">{isAr ? "هل تريد البيع أيضًا؟" : "Want to sell USDT too?"}</p>
              <p className="mt-2 text-sm text-[#9CA3AF]">{prominent
                ? (isAr ? "قدّم طلب اعتماد البائع ليتمكن حسابك من نشر العروض وبناء مستوى البائع إلى جانب رتبة المشتري." : "Apply for seller approval to publish offers and build your seller level alongside your buyer rank.")
                : (isAr ? "أبقينا هذه الصفحة مركزة على المشتري. افتح طلب البائع فقط إذا كنت تريد التقديم لبدء البيع أيضًا." : "This page stays focused on the buyer workflow. Open the seller application only if you want to start selling too.")}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" onClick={() => onExpandedChange(true)}>{isAr ? "فتح طلب البائع" : "Open Seller Application"}</Button>
                <Button type="button" variant="secondary" onClick={() => document.getElementById("marketplace")?.scrollIntoView({ behavior: "smooth", block: "start" })}>{isAr ? "العودة إلى السوق" : "Back to Marketplace"}</Button>
              </div>
            </div>
          ) : isLoading && isApprovedSellerSession ? (
            <div className="space-y-3"><div className="h-4 w-44 animate-pulse rounded bg-white/10" /><div className="h-20 w-full animate-pulse rounded-2xl bg-white/10" /><div className="h-20 w-full animate-pulse rounded-2xl bg-white/10" /></div>
          ) : eligibility === "loading" ? (
            <div className="space-y-3" aria-label={isAr ? "جارٍ تحميل حالة الحساب" : "Loading account status"}><div className="h-4 w-44 animate-pulse rounded bg-white/10" /><div className="h-20 w-full animate-pulse rounded-2xl bg-white/10" /></div>
          ) : eligibility === "retry" ? (
            <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-5"><p className="font-semibold text-white">{isAr ? "تعذر تحديث حالة الحساب" : "Unable to refresh account status"}</p><Button type="button" className="mt-4" onClick={() => window.location.reload()}>{isAr ? "إعادة المحاولة" : "Retry"}</Button></div>
          ) : eligibility === "buyer_setup_required" ? (
            <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-5">
              <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" /><div><p className="font-semibold text-white">{isAr ? "أكمل إعداد حساب المشتري أولاً" : "Complete Buyer Setup First"}</p><p className="mt-2 text-sm text-[#E5E7EB]">{isAr ? "يجب أن يكون لديك حساب مشترٍ قبل التقديم كبائع. ستتم مراجعة طلبات البائعين يدويًا وقد يُطلب تحقق إضافي." : "You need a buyer account before applying as a seller. Seller applications are reviewed manually and may require additional verification."}</p><Button type="button" className="mt-4 w-full" onClick={onSetUpBuyer}>{isAr ? "إعداد حساب مشترٍ" : "Set Up Buyer Account"}</Button></div></div>
            </div>
          ) : eligibility === "application_pending" ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[#C9A227]/35 bg-[#C9A227]/10 p-5"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#C9A227]/50 bg-[#C9A227]/20"><Clock3 className="h-5 w-5 text-[#F4D87A]" /></div><div><p className="font-semibold text-white">{isAr ? "الطلب قيد المراجعة" : "Application Pending Review"}</p><p className="mt-0.5 text-xs text-[#D1D5DB]">{application?.createdAt ? `${isAr ? "تاريخ التقديم" : "Submitted"}: ${new Date(application.createdAt).toLocaleDateString(isAr ? "ar-IL" : "en-IL")}` : (isAr ? "تم إرسال الطلب" : "Application submitted")}</p></div></div></div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-[#D1D5DB]">
                <p className="mb-3 text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "ماذا يحدث بعد ذلك" : "What Happens Next"}</p>
                <div className="space-y-2">{[isAr ? "سيراجع فريق Alpha Traders طلبك." : "The Alpha Traders team will review your application.", isAr ? "سيتواصل معك المالك عبر WhatsApp باستخدام الرقم الذي قدمته في الطلب." : "The owner will contact you via WhatsApp using the number in your application.", isAr ? "قد تُطلب منك معلومات أو تحقق إضافي." : "Additional verification or information may be requested.", isAr ? "بعد الموافقة ستحصل على شارة البائع المعتمد." : "Upon approval, you receive the Approved Seller badge and marketplace access."].map((step, index) => <div key={step} className="flex items-start gap-2"><span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#C9A227]/40 bg-[#C9A227]/10 text-[10px] font-semibold text-[#F4D87A]">{index + 1}</span><p>{step}</p></div>)}</div>
              </div>
              <p className="rounded-xl border border-[#6CAEFF]/30 bg-[#6CAEFF]/10 px-4 py-3 text-xs text-[#BFDBFE]">{isAr ? "سنتواصل معك عبر WhatsApp باستخدام الرقم الذي قدمته في الطلب." : "We'll contact you via WhatsApp using the number in your application."}</p>
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]">
                <p className="mb-3 text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "عملية الموافقة" : "Approval Process"}</p>
                <div className="space-y-2">{[isAr ? "يدخل طلبك في مراجعة يدوية." : "Your application enters manual review.", isAr ? "سيتواصل معك مالك Alpha Traders عبر WhatsApp باستخدام الرقم الذي تقدمه في الطلب." : "The Alpha Traders owner will contact you via WhatsApp using the number you provide in your application.", isAr ? "قد تُطلب منك معلومات إضافية." : "Additional verification or information may be requested.", isAr ? "بعد الموافقة تحصل على شارة البائع المعتمد وصلاحيات النشر." : "Once approved, you receive the Approved Seller badge and marketplace selling privileges."].map((step, index) => <div key={step} className="flex items-start gap-2"><span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 text-[10px] font-semibold text-[#F4D87A]">{index + 1}</span><p>{step}</p></div>)}</div>
              </div>
              {statusMessage ? <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-[#FDE68A]"><AlertTriangle className="h-3.5 w-3.5 shrink-0" /><span>{statusMessage}</span></div> : null}
              <form className="space-y-3" onSubmit={onSubmit}>
                <p className="text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "المعلومات الشخصية" : "Personal Information"}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><FieldLabel htmlFor="seller-first-name" required>{isAr ? "الاسم الأول" : "First Name"}</FieldLabel><Input id="seller-first-name" placeholder={isAr ? "الاسم الأول" : "First name"} value={form.firstName} required aria-required onChange={(event) => onFormChange("firstName", event.target.value)} className={requiredFieldClasses({ value: form.firstName, required: true })} /></div>
                  <div className="space-y-1.5"><FieldLabel htmlFor="seller-last-name" required>{isAr ? "اسم العائلة" : "Last Name"}</FieldLabel><Input id="seller-last-name" placeholder={isAr ? "اسم العائلة" : "Last name"} value={form.lastName} required aria-required onChange={(event) => onFormChange("lastName", event.target.value)} className={requiredFieldClasses({ value: form.lastName, required: true })} /></div>
                </div>
                <div className="relative"><FieldLabel htmlFor="seller-email" className="mb-1.5">{isAr ? "البريد الإلكتروني" : "Email"}</FieldLabel><Input id="seller-email" type="email" value={form.email || sessionEmail} readOnly aria-label={isAr ? "البريد الإلكتروني" : "Email"} className="cursor-default opacity-75" /><span className="pointer-events-none absolute end-3 top-[2.35rem] rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 px-2 py-0.5 text-[10px] font-medium text-[#D4AF37]">{isAr ? "من الحساب" : "From account"}</span></div>
                <div className="space-y-1.5"><FieldLabel htmlFor="seller-whatsapp" required>{isAr ? "رقم الهاتف / WhatsApp" : "WhatsApp / Phone Number"}</FieldLabel><Input id="seller-whatsapp" placeholder={isAr ? "رقم الهاتف / WhatsApp" : "WhatsApp / phone number"} value={form.whatsappNumber} required aria-required onChange={(event) => onFormChange("whatsappNumber", event.target.value)} className={requiredFieldClasses({ value: form.whatsappNumber, required: true })} /></div>
                <p className="pt-1 text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "طرق البيع المدعومة" : "Supported Selling Methods"}</p>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="mb-3 text-xs text-[#9CA3AF]">{isAr ? "اختر طريقة أو أكثر." : "Select one or more methods."}</p>
                  <div className="grid gap-4 sm:grid-cols-2">{(["Crypto", "Fiat"] as const).map((group) => <div key={group} className="space-y-2"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? (group === "Crypto" ? "عملات رقمية" : "عملات تقليدية") : group}</p><div className="grid gap-2">{SELLER_APPLICATION_METHOD_OPTIONS.filter((method) => method.group === group).map((method) => { const selected = methods.includes(method.id); return <button key={method.id} type="button" onClick={() => onMethodToggle(method.id)} className={`rounded-xl border px-3 py-2.5 text-start text-sm transition ${selected ? "border-[#C9A227]/60 bg-[#C9A227]/10 text-white ring-1 ring-[#C9A227]/30" : "border-white/10 bg-black/25 text-[#D1D5DB] hover:border-[#C9A227]/30 hover:text-white"}`}><div className="flex items-center justify-between gap-2"><span>{sellerApplicationMethodLabel(method.id, isAr)}</span><span className="flex items-center gap-1.5">{method.recommended ? <span className="rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#D4AF37]">⭐ {isAr ? "موصى به" : "Recommended"}</span> : null}{selected ? <CheckCircle2 className="h-4 w-4 text-[#C9A227]" /> : <span className="h-4 w-4 rounded-full border border-white/20" />}</span></div></button>; })}</div></div>)}</div>
                </div>
                <p className="pt-1 text-[11px] uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "التداول الشهري المتوقع" : "Expected Monthly Trading Volume"}</p>
                <Input placeholder={isAr ? "مثال: 5,000 USDT شهريًا" : "e.g. 5,000 USDT per month"} value={form.expectedMonthlyTradingVolume} onChange={(event) => onFormChange("expectedMonthlyTradingVolume", event.target.value)} />
                <Textarea placeholder={isAr ? "ملاحظات إضافية (اختياري)" : "Additional notes (optional)"} value={form.additionalNotes} onChange={(event) => onFormChange("additionalNotes", event.target.value)} />
                <Button type="submit" className="w-full" disabled={!form.firstName || !form.lastName || !form.whatsappNumber || methods.length === 0}>{isAr ? "قدّم طلب الاعتماد" : "Apply for Approval"}</Button>
              </form>
              <p className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-[#9CA3AF]">{isAr ? "تتم الموافقة على البائعين يدويًا لحماية المشترين والحفاظ على سوق موثوق. تُراجَع الطلبات بشكل فردي وقد يُطلب تحقق إضافي." : "Seller approval is performed manually to protect buyers and maintain a trusted marketplace. Applications are reviewed individually and additional verification may be requested before approval."}</p>
              {shouldCondense ? <Button type="button" variant="secondary" onClick={() => onExpandedChange(false)}>{isAr ? "إخفاء طلب البائع" : "Hide Seller Application"}</Button> : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-[#0B0B0B]/90">
        <CardHeader><CardTitle>{isAr ? "ابحث عن بائع معتمد" : "Find an Approved Seller"}</CardTitle><CardDescription>{isAr ? "تصفح البائعين المعتمدين وابدأ صفقة USDT آمنة ومُنسَّقة من خلال Alpha Exchange." : "Browse verified sellers and start a secure USDT trade coordinated through Alpha Exchange."}</CardDescription></CardHeader>
        <CardContent><div className="space-y-4"><div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB]"><p className="mb-2 font-medium text-white">{isAr ? "كيف تشتري USDT:" : "How to buy USDT:"}</p><ol className="list-inside list-decimal space-y-2"><li>{isAr ? "تصفح" : "Browse the"} <a href="#marketplace" className="text-[#93C5FD] hover:underline">{isAr ? "السوق المباشر" : "Live Marketplace"}</a> {isAr ? "أعلاه" : "above"}</li><li>{isAr ? "اختر بائعًا موثقًا يناسب احتياجاتك" : "Choose a verified seller that fits your needs"}</li><li>{isAr ? "اضغط" : "Click"} <strong className="text-white">{isAr ? "شراء USDT" : "Buy USDT"}</strong> {isAr ? "على عرضه" : "on their listing"}</li><li>{isAr ? "أدخل تفاصيل الصفقة وأرسلها" : "Fill in your trade details and submit"}</li><li>{isAr ? "Alpha Traders تنسق الباقي" : "Alpha Traders coordinates the rest"}</li></ol></div><a href="#marketplace"><Button className="w-full">{isAr ? "تصفح البائعين" : "Browse Sellers"}</Button></a><p className="text-center text-xs text-[#9CA3AF]">{isAr ? "هل تحتاج مساعدة؟" : "Need help?"}{" "}{WHATSAPP_URL ? <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="text-[#93C5FD] hover:underline">{isAr ? "تواصل مع Alpha Traders على WhatsApp" : "Contact Alpha Traders on WhatsApp"}</a> : null}</p></div></CardContent>
      </Card>
    </div>
  );
}
