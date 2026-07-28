"use client";

import { useState, useRef, useId } from "react";
import { Loader2, CheckCircle2, AlertCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Locale = "ar" | "en";

const T = {
  en: {
    formTitle: "Send us a message",
    name: "Full Name",
    namePlaceholder: "Your full name",
    nameMin: "Name must be at least 2 characters.",
    email: "Email Address",
    emailPlaceholder: "your@email.com",
    emailInvalid: "Please enter a valid email address.",
    subject: "Subject",
    subjectPlaceholder: "How can we help?",
    subjectMin: "Subject must be at least 2 characters.",
    message: "Message",
    messagePlaceholder: "Tell us more…",
    messageMin: "Message must be at least 10 characters.",
    messageMax: "Message must not exceed 4000 characters.",
    send: "Send Message",
    sending: "Sending…",
    successTitle: "Message received!",
    successBody: "Your message has been received and will be reviewed shortly.",
    errorGeneric: "Something went wrong. Please try again.",
    errorRate: "Too many requests. Please wait a moment and try again.",
    errorValidation: "Please fix the highlighted fields and try again.",
    required: "Required",
  },
  ar: {
    formTitle: "أرسل لنا رسالة",
    name: "الاسم الكامل",
    namePlaceholder: "اسمك الكامل",
    nameMin: "يجب أن يكون الاسم حرفين على الأقل.",
    email: "البريد الإلكتروني",
    emailPlaceholder: "example@email.com",
    emailInvalid: "يرجى إدخال بريد إلكتروني صحيح.",
    subject: "الموضوع",
    subjectPlaceholder: "كيف يمكننا مساعدتك؟",
    subjectMin: "يجب أن يكون الموضوع حرفين على الأقل.",
    message: "الرسالة",
    messagePlaceholder: "أخبرنا بالمزيد…",
    messageMin: "يجب أن تكون الرسالة 10 أحرف على الأقل.",
    messageMax: "يجب ألا تتجاوز الرسالة 4000 حرف.",
    send: "إرسال الرسالة",
    sending: "جارٍ الإرسال…",
    successTitle: "تم استلام رسالتك!",
    successBody: "تم استلام رسالتك وستتم مراجعتها قريباً.",
    errorGeneric: "حدث خطأ ما. يرجى المحاولة مجدداً.",
    errorRate: "طلبات كثيرة جداً. يرجى الانتظار قليلاً والمحاولة مجدداً.",
    errorValidation: "يرجى تصحيح الحقول المميزة والمحاولة مجدداً.",
    required: "مطلوب",
  },
} satisfies Record<Locale, Record<string, string>>;

function validateClient(values: Record<string, string>, t: (typeof T)[Locale]) {
  const errors: Record<string, string> = {};
  if (!values.name || values.name.trim().length < 2) errors.name = t.nameMin;
  if (!values.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = t.emailInvalid;
  if (!values.subject || values.subject.trim().length < 2) errors.subject = t.subjectMin;
  if (!values.message || values.message.trim().length < 10) errors.message = t.messageMin;
  if (values.message && values.message.length > 4000) errors.message = t.messageMax;
  return errors;
}

export function ContactForm({ locale }: { locale: Locale }) {
  const t = T[locale] ?? T.en;
  const isRtl = locale === "ar";

  const uid = useId();
  const nameId = `${uid}-name`;
  const emailId = `${uid}-email`;
  const subjectId = `${uid}-subject`;
  const messageId = `${uid}-message`;

  const [values, setValues] = useState({ name: "", email: "", subject: "", message: "" });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const honeypotRef = useRef<HTMLInputElement>(null);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValues((prev) => ({ ...prev, [field]: e.target.value }));
    if (fieldErrors[field]) setFieldErrors((prev) => { const next = { ...prev }; delete next[field]; return next; });
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const errors = validateClient(values, t);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setStatus("error");
      setErrorMsg(t.errorValidation);
      return;
    }

    setStatus("loading");
    setErrorMsg("");
    setFieldErrors({});

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          name: values.name.trim(),
          email: values.email.trim(),
          subject: values.subject.trim(),
          message: values.message.trim(),
          locale,
          website: honeypotRef.current?.value ?? "",
        }),
      });

      if (res.status === 429) {
        setStatus("error");
        setErrorMsg(t.errorRate);
        return;
      }

      if (res.status === 400) {
        const data = await res.json().catch(() => ({}));
        if (data.issues) {
          const mapped: Record<string, string> = {};
          for (const [k, msgs] of Object.entries(data.issues as Record<string, string[]>)) {
            mapped[k] = Array.isArray(msgs) ? msgs[0] : String(msgs);
          }
          setFieldErrors(mapped);
        }
        setStatus("error");
        setErrorMsg(t.errorValidation);
        return;
      }

      if (!res.ok) {
        setStatus("error");
        setErrorMsg(t.errorGeneric);
        return;
      }

      setStatus("success");
      setValues({ name: "", email: "", subject: "", message: "" });
    } catch {
      setStatus("error");
      setErrorMsg(t.errorGeneric);
    }
  }

  if (status === "success") {
    return (
      <div className="mt-8 flex max-w-3xl flex-col items-center gap-4 rounded-2xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-8 text-center">
        <CheckCircle2 className="h-12 w-12 text-[#C9A227]" aria-hidden="true" />
        <h2 className="text-xl font-semibold text-white">{t.successTitle}</h2>
        <p className="text-sm text-white/70">{t.successBody}</p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-2 text-sm text-[#C9A227] underline underline-offset-2 hover:opacity-80"
        >
          {locale === "ar" ? "إرسال رسالة أخرى" : "Send another message"}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={t.formTitle}
      dir={isRtl ? "rtl" : "ltr"}
      className="mt-8 grid max-w-3xl gap-5 rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-6"
    >
      <h2 className="text-base font-semibold text-white/80">{t.formTitle}</h2>

      {/* Honeypot — hidden from real users */}
      <input
        ref={honeypotRef}
        type="text"
        name="website"
        tabIndex={-1}
        aria-hidden="true"
        autoComplete="off"
        className="absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0"
      />

      {/* Name */}
      <div className="grid gap-1.5">
        <label htmlFor={nameId} className="text-sm text-white/60">
          {t.name} <span className="text-[#C9A227]">*</span>
        </label>
        <Input
          id={nameId}
          name="name"
          type="text"
          autoComplete="name"
          placeholder={t.namePlaceholder}
          value={values.name}
          onChange={set("name")}
          disabled={status === "loading"}
          aria-invalid={!!fieldErrors.name}
          aria-describedby={fieldErrors.name ? `${nameId}-err` : undefined}
          required
        />
        {fieldErrors.name && (
          <p id={`${nameId}-err`} role="alert" className="flex items-center gap-1 text-xs text-red-400">
            <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            {fieldErrors.name}
          </p>
        )}
      </div>

      {/* Email */}
      <div className="grid gap-1.5">
        <label htmlFor={emailId} className="text-sm text-white/60">
          {t.email} <span className="text-[#C9A227]">*</span>
        </label>
        <Input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          placeholder={t.emailPlaceholder}
          value={values.email}
          onChange={set("email")}
          disabled={status === "loading"}
          aria-invalid={!!fieldErrors.email}
          aria-describedby={fieldErrors.email ? `${emailId}-err` : undefined}
          required
        />
        {fieldErrors.email && (
          <p id={`${emailId}-err`} role="alert" className="flex items-center gap-1 text-xs text-red-400">
            <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            {fieldErrors.email}
          </p>
        )}
      </div>

      {/* Subject */}
      <div className="grid gap-1.5">
        <label htmlFor={subjectId} className="text-sm text-white/60">
          {t.subject} <span className="text-[#C9A227]">*</span>
        </label>
        <Input
          id={subjectId}
          name="subject"
          type="text"
          placeholder={t.subjectPlaceholder}
          value={values.subject}
          onChange={set("subject")}
          disabled={status === "loading"}
          aria-invalid={!!fieldErrors.subject}
          aria-describedby={fieldErrors.subject ? `${subjectId}-err` : undefined}
          required
        />
        {fieldErrors.subject && (
          <p id={`${subjectId}-err`} role="alert" className="flex items-center gap-1 text-xs text-red-400">
            <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            {fieldErrors.subject}
          </p>
        )}
      </div>

      {/* Message */}
      <div className="grid gap-1.5">
        <label htmlFor={messageId} className="text-sm text-white/60">
          {t.message} <span className="text-[#C9A227]">*</span>
        </label>
        <Textarea
          id={messageId}
          name="message"
          placeholder={t.messagePlaceholder}
          value={values.message}
          onChange={set("message")}
          disabled={status === "loading"}
          aria-invalid={!!fieldErrors.message}
          aria-describedby={fieldErrors.message ? `${messageId}-err` : undefined}
          rows={5}
          required
        />
        <div className={`flex items-center gap-1 ${fieldErrors.message ? "justify-between" : "justify-end"}`}>
          {fieldErrors.message && (
            <p id={`${messageId}-err`} role="alert" className="flex items-center gap-1 text-xs text-red-400">
              <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
              {fieldErrors.message}
            </p>
          )}
          <span className="text-xs text-white/30" aria-live="polite">
            {values.message.length}/4000
          </span>
        </div>
      </div>

      {/* Global error banner */}
      {status === "error" && errorMsg && !Object.keys(fieldErrors).length && (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          {errorMsg}
        </p>
      )}

      <Button type="submit" disabled={status === "loading"} className="gap-2 self-start">
        {status === "loading" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t.sending}
          </>
        ) : (
          <>
            <Send className="h-4 w-4" aria-hidden="true" />
            {t.send}
          </>
        )}
      </Button>
    </form>
  );
}
