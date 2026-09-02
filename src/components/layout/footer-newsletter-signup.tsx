"use client";

import { useState, type FormEvent } from "react";
import type { AppLocale } from "@/i18n/routing";

type SubmissionStatus = "idle" | "submitting" | "success" | "error";

const COPY = {
  en: {
    label: "Newsletter email address",
    placeholder: "Email Address",
    submit: "Subscribe",
    submitting: "Submitting…",
    success: "Subscription request received.",
    rateLimit: "Too many requests. Please try again later.",
    error: "We could not submit your request. Please try again.",
    subject: "Newsletter subscription request",
    message: "Please add this email address to the Alpha Traders newsletter mailing list.",
  },
  ar: {
    label: "البريد الإلكتروني للنشرة البريدية",
    placeholder: "البريد الإلكتروني",
    submit: "اشترك",
    submitting: "جارٍ الإرسال…",
    success: "تم استلام طلب الاشتراك.",
    rateLimit: "طلبات كثيرة جدًا. يرجى المحاولة لاحقًا.",
    error: "تعذر إرسال طلبك. يرجى المحاولة مرة أخرى.",
    subject: "طلب اشتراك في النشرة البريدية",
    message: "يرجى إضافة هذا البريد الإلكتروني إلى القائمة البريدية للنشرة الإخبارية من Alpha Traders.",
  },
} as const;

export function FooterNewsletterSignup({ locale }: { locale: AppLocale }) {
  const copy = COPY[locale];
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<SubmissionStatus>("idle");
  const [feedback, setFeedback] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setFeedback("");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Locale": locale },
        body: JSON.stringify({
          name: "Newsletter subscriber",
          email: email.trim(),
          subject: copy.subject,
          message: copy.message,
          locale,
          website: "",
        }),
      });

      if (response.ok) {
        setEmail("");
        setStatus("success");
        setFeedback(copy.success);
        return;
      }

      setStatus("error");
      setFeedback(response.status === 429 ? copy.rateLimit : copy.error);
    } catch {
      setStatus("error");
      setFeedback(copy.error);
    }
  }

  return (
    <form className="mt-4" onSubmit={handleSubmit} aria-label={copy.submit}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="footer-newsletter-email" className="sr-only">
          {copy.label}
        </label>
        <input
          id="footer-newsletter-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (status !== "idle") {
              setStatus("idle");
              setFeedback("");
            }
          }}
          placeholder={copy.placeholder}
          className="h-11 w-full rounded-xl border border-white/15 bg-black/40 px-3 text-sm text-white outline-none transition focus:border-[#C9A227]/55 focus:ring-1 focus:ring-[#C9A227]/40"
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          aria-busy={status === "submitting"}
          className="group relative inline-flex h-11 items-center justify-center overflow-hidden rounded-xl border border-[#D4AF37]/45 bg-gradient-to-r from-[#B78C1E] via-[#D4AF37] to-[#C79C2A] px-5 text-sm font-semibold text-black shadow-[0_10px_20px_rgba(201,162,39,0.35)] transition hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70"
        >
          <span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-white/35 opacity-0 transition-all duration-700 group-hover:left-[120%] group-hover:opacity-100" />
          {status === "submitting" ? copy.submitting : copy.submit}
        </button>
      </div>
      <p
        className={`mt-2 min-h-5 text-sm ${status === "success" ? "text-emerald-300" : "text-rose-300"}`}
        role="status"
        aria-live="polite"
      >
        {feedback}
      </p>
    </form>
  );
}
