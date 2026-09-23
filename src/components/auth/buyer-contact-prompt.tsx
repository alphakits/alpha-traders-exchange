"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { LockKeyhole, Phone } from "lucide-react";
import { normalizeRegistrationWhatsApp } from "@alpha-traders/contracts";
import { usePathname } from "@/i18n/navigation";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { needsBuyerContact } from "@/lib/buyer-contact";

export function BuyerContactPrompt({ locale }: { locale: "en" | "ar" }) {
  const session = useOptionalCanonicalSession();
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const isAr = locale === "ar";
  // Essential account/legal support remains accessible while a contact is missing.
  const supportPath = /\/(account-deletion|support|help-center|privacy-policy|terms)(?:\/|$)/.test(pathname);
  const required = !supportPath && needsBuyerContact(session?.user) && savedFor !== session?.user?.id;

  useEffect(() => {
    setPhone(session?.user?.whatsappNumber ?? "");
    setError("");
    setSavedFor(null);
  }, [session?.user?.id, session?.user?.whatsappNumber]);

  useEffect(() => {
    const element = dialog.current;
    if (required && element && !element.open) element.showModal();
    if (!required && element?.open) element.close();
  }, [required]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !session?.user) return;
    const normalized = normalizeRegistrationWhatsApp(phone);
    if (!normalized) {
      setError(isAr ? "أدخل رقمًا صالحًا مع رمز الدولة، مثل ‎+972501234567." : "Enter a valid number with its country code, such as +972501234567.");
      return;
    }
    const userId = session.user.id;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/auth/profile", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Locale": locale },
        body: JSON.stringify({ whatsappNumber: normalized }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !normalizeRegistrationWhatsApp(result?.profile?.whatsappNumber)) {
        setError(isAr ? "تعذر حفظ الرقم. يرجى التحقق منه والمحاولة مرة أخرى." : "We couldn’t save the number. Please check it and try again.");
        return;
      }
      setSavedFor(userId);
      await session.refresh({ force: true, background: true });
      window.dispatchEvent(new Event("alpha-profile-updated"));
    } catch {
      setError(isAr ? "تعذر الاتصال. يرجى المحاولة مرة أخرى." : "Connection failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("logout");
      window.dispatchEvent(new Event("alpha-auth-signed-out"));
      window.location.assign("/en/login");
    } catch {
      setError(isAr ? "تعذر تسجيل الخروج. حاول مرة أخرى." : "Unable to sign out. Please try again.");
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="buyer-contact-title" aria-describedby="buyer-contact-description" dir={isAr ? "rtl" : "ltr"}
      onCancel={event => event.preventDefault()}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-3xl border border-[#C9A227]/30 bg-[#101116] p-6 text-white shadow-2xl backdrop:bg-black/80 backdrop:backdrop-blur-sm">
      <BuyerContactForm locale={locale} phone={phone} setPhone={setPhone} saving={saving} error={error} onSubmit={submit} onSignOut={signOut} />
    </dialog>
  );
}

function BuyerContactForm({ locale, phone, setPhone, saving, error, onSubmit, onSignOut }: {
  locale: "en" | "ar"; phone: string; setPhone: (value: string) => void; saving: boolean; error: string;
  onSubmit: (event: FormEvent) => void | Promise<void>; onSignOut: () => void | Promise<void>;
}) {
  const isAr = locale === "ar";
  return <>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[#C9A227]/30 bg-[#C9A227]/10 text-[#F4D87A]"><Phone aria-hidden="true" className="h-6 w-6" /></div>
      <h2 id="buyer-contact-title" className="text-xl font-semibold">{isAr ? "أضف رقمًا للتواصل عند الحاجة" : "A number to reach you when needed"}</h2>
      <p id="buyer-contact-description" className="mt-3 text-sm leading-6 text-[#C1C7D2]">{isAr ? "يرجى إضافة رقم هاتفك أو واتساب حتى يتمكن مالك المنصة من التواصل معك بشأن أمر عاجل يتعلق بصفقتك أو حسابك." : "Please add your phone or WhatsApp number so the owner can reach you about an urgent trade or account issue."}</p>
      <p className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs leading-5 text-emerald-200"><LockKeyhole aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{isAr ? "رقمك خاص. لا يراه إلا أنت ومالك المنصة، ولا يظهر للمشترين أو البائعين." : "Your number is private. Only you and the owner can see it. It is hidden from buyers and sellers."}</p>
      <form className="mt-5 space-y-4" onSubmit={event => void onSubmit(event)}>
        <label className="block text-sm" htmlFor="buyer-private-phone">{isAr ? "رقم الهاتف أو واتساب (مطلوب)" : "Phone or WhatsApp number (required)"}</label>
        <Input id="buyer-private-phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" required maxLength={30} value={phone} onChange={event => setPhone(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? "buyer-contact-error" : undefined} placeholder="+972 50 123 4567" autoFocus />
        {error ? <p id="buyer-contact-error" role="alert" className="text-sm text-red-300">{error}</p> : null}
        <Button type="submit" className="w-full" loading={saving} loadingLabel={isAr ? "جاري الحفظ…" : "Saving…"}>{isAr ? "حفظ الرقم والمتابعة" : "Save number and continue"}</Button>
        <Button type="button" variant="ghost" className="w-full" disabled={saving} onClick={() => void onSignOut()}>{isAr ? "تسجيل الخروج" : "Sign out"}</Button>
      </form>
  </>;
}

/** Presentation-only sample, mounted exclusively by the non-production preview route. */
export function BuyerContactPreview({ locale }: { locale: "en" | "ar" }) {
  const [phone, setPhone] = useState("");
  return <section dir={locale === "ar" ? "rtl" : "ltr"} className="w-full max-w-md rounded-3xl border border-[#C9A227]/30 bg-[#101116] p-6 text-white shadow-2xl">
    <BuyerContactForm locale={locale} phone={phone} setPhone={setPhone} saving={false} error="" onSubmit={event => event.preventDefault()} onSignOut={() => {}} />
  </section>;
}
