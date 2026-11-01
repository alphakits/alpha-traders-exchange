import { LockKeyhole, Phone } from "lucide-react";

/** Render only contact data projected by the server for the canonical owner. */
export function OwnerPrivateContact({ contact, locale }: {
  contact?: { email?: string; phone?: string };
  locale: "en" | "ar";
}) {
  if (!contact?.email && !contact?.phone) return null;
  const isAr = locale === "ar";
  return (
    <section className="my-5 rounded-2xl border border-red-400/25 bg-red-400/[0.04] p-4" aria-label={isAr ? "بيانات تواصل خاصة بالمالك" : "Owner-only private contact"}>
      <p className="flex items-center gap-2 text-sm font-semibold text-red-200"><LockKeyhole className="h-4 w-4" aria-hidden="true" />{isAr ? "بيانات التواصل · للمالك فقط" : "Private contact · owner only"}</p>
      <p className="mt-2 text-xs text-[#A6AFBE]">{isAr ? "لا تظهر هذه البيانات للمستخدمين الآخرين." : "Other users cannot see these details."}</p>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
        {contact.phone ? <a href={`tel:${contact.phone}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 px-3 text-white"><Phone className="h-4 w-4" aria-hidden="true" /><bdi dir="ltr">{contact.phone}</bdi></a> : <span className="text-amber-200">{isAr ? "لم تتم إضافة رقم بعد" : "Phone number not added yet"}</span>}
        {contact.email ? <bdi dir="ltr" className="break-all text-[#D1D5DB]">{contact.email}</bdi> : null}
      </div>
    </section>
  );
}
