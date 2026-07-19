"use client";

import { useState, type FormEvent } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RegisterForm({ locale }: { locale: "ar" | "en" }) {
  const isAr = locale === "ar";
  const router = useRouter();
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
    whatsappNumber: "",
    inviteCode: "",
    agreedToTerms: false,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function readApiError(response: Response, fallback: string) {
    try {
      const payload = (await response.json()) as { error?: string };
      return payload.error ?? fallback;
    } catch {
      return fallback;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        setErrorMessage(await readApiError(response, "Registration failed."));
        return;
      }
      router.push("/usdt-exchange");
    } catch {
      setErrorMessage(isAr ? "تعذر الاتصال بالخادم. حاول مرة أخرى." : "Unable to reach the server. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="section-container page-shell">
      <div className="mx-auto w-full max-w-xl rounded-3xl border border-white/10 bg-[#0B0B0B]/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.4)] backdrop-blur-xl md:p-8">
        <h1 className="text-3xl font-semibold md:text-4xl">{isAr ? "إنشاء حساب" : "Register"}</h1>
        <p className="mt-2 text-sm text-[#9CA3AF]">
          {isAr ? "التسجيل في النسخة التجريبية الخاصة يتم عبر كود دعوة فقط. كل حساب جديد يُنشأ كمشتري." : "Private beta registration is invite-only. Every new account is created as a Buyer."}
        </p>

        <form className="mt-6 grid gap-3" onSubmit={handleSubmit}>
          <Input placeholder={isAr ? "الاسم الكامل" : "Full Name"} autoComplete="name" required value={form.fullName} onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))} />
          <Input placeholder={isAr ? "البريد الإلكتروني" : "Email"} type="email" autoComplete="email" required value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} />
          <Input placeholder={isAr ? "كلمة المرور" : "Password"} type="password" autoComplete="new-password" required value={form.password} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} />
          <Input placeholder={isAr ? "تأكيد كلمة المرور" : "Confirm Password"} type="password" autoComplete="new-password" required value={form.confirmPassword} onChange={(event) => setForm((prev) => ({ ...prev, confirmPassword: event.target.value }))} />
          <Input placeholder={isAr ? "رقم الواتساب" : "WhatsApp Number"} autoComplete="tel" required value={form.whatsappNumber} onChange={(event) => setForm((prev) => ({ ...prev, whatsappNumber: event.target.value }))} />
          <Input placeholder={isAr ? "كود الدعوة" : "Invite Code"} required value={form.inviteCode} onChange={(event) => setForm((prev) => ({ ...prev, inviteCode: event.target.value.toUpperCase() }))} />
          <label className={`inline-flex items-start gap-2 text-sm text-[#D1D5DB] ${isAr ? "flex-row-reverse" : ""}`}>
            <input
              type="checkbox"
              checked={form.agreedToTerms}
              onChange={(event) => setForm((prev) => ({ ...prev, agreedToTerms: event.target.checked }))}
              className="mt-0.5 h-4 w-4 rounded border-white/30 bg-transparent accent-[#C9A227]"
            />
            {isAr ? "أوافق على شروط الخدمة." : "I agree to the Terms of Service."}
          </label>
          <Button type="submit" disabled={isSubmitting}>{isSubmitting ? (isAr ? "جاري الإنشاء..." : "Creating...") : (isAr ? "إنشاء الحساب" : "Create Account")}</Button>
        </form>

        {errorMessage ? <p className="mt-3 text-sm text-rose-300" role="status" aria-live="polite">{errorMessage}</p> : null}

        <p className="mt-5 text-sm text-[#9CA3AF]">
          {isAr ? "لديك حساب بالفعل؟" : "Already have an account?"}{" "}
          <Link href="/login" className="text-[#C9A227] hover:underline">
            {isAr ? "تسجيل الدخول" : "Login"}
          </Link>
        </p>
      </div>
    </section>
  );
}
