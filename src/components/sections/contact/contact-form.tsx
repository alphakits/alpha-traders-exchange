"use client";

import { ActionFeedback } from "@/components/ui/action-feedback";
import { useState, useRef, useId } from "react";
import { Loader2, CheckCircle2, AlertCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LEARNING_EXPERIENCE, LEARNING_INTEREST_SUBJECT, LEARNING_INTEREST_TOPIC, type LearningDetails } from "@/lib/learning-interest";
import { readLearningCampaign } from "@/lib/learning-campaign-client";

type Locale = "ar" | "en";

const T = {
  en: {
    formTitle: "Send us a message",
    name: "Full Name",
    namePlaceholder: "Your full name",
    nameMin: "Name must be at least 2 characters.",
    nameMax: "Name must not exceed 100 characters.",
    email: "Email Address",
    emailPlaceholder: "your@email.com",
    emailInvalid: "Please enter a valid email address.",
    emailMax: "Email address must not exceed 254 characters.",
    subject: "Subject",
    subjectPlaceholder: "How can we help?",
    subjectMin: "Subject must be at least 2 characters.",
    subjectMax: "Subject must not exceed 200 characters.",
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
    nameMax: "يجب ألا يتجاوز الاسم 100 حرف.",
    email: "البريد الإلكتروني",
    emailPlaceholder: "example@email.com",
    emailInvalid: "يرجى إدخال بريد إلكتروني صحيح.",
    emailMax: "يجب ألا يتجاوز البريد الإلكتروني 254 حرفاً.",
    subject: "الموضوع",
    subjectPlaceholder: "كيف يمكننا مساعدتك؟",
    subjectMin: "يجب أن يكون الموضوع حرفين على الأقل.",
    subjectMax: "يجب ألا يتجاوز الموضوع 200 حرف.",
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

type ContactIssueCode =
  | "NAME_REQUIRED"
  | "NAME_TOO_SHORT"
  | "NAME_TOO_LONG"
  | "EMAIL_REQUIRED"
  | "EMAIL_INVALID"
  | "EMAIL_TOO_LONG"
  | "SUBJECT_REQUIRED"
  | "SUBJECT_TOO_SHORT"
  | "SUBJECT_TOO_LONG"
  | "MESSAGE_REQUIRED"
  | "MESSAGE_TOO_SHORT"
  | "MESSAGE_TOO_LONG";

function localizeContactIssue(
  field: string,
  code: string | undefined,
  t: (typeof T)[Locale],
) {
  const copy: Partial<Record<ContactIssueCode, string>> = {
    NAME_REQUIRED: t.required,
    NAME_TOO_SHORT: t.nameMin,
    NAME_TOO_LONG: t.nameMax,
    EMAIL_REQUIRED: t.required,
    EMAIL_INVALID: t.emailInvalid,
    EMAIL_TOO_LONG: t.emailMax,
    SUBJECT_REQUIRED: t.required,
    SUBJECT_TOO_SHORT: t.subjectMin,
    SUBJECT_TOO_LONG: t.subjectMax,
    MESSAGE_REQUIRED: t.required,
    MESSAGE_TOO_SHORT: t.messageMin,
    MESSAGE_TOO_LONG: t.messageMax,
  };
  if (code && copy[code as ContactIssueCode]) return copy[code as ContactIssueCode];

  // Handle old or unexpected API responses by field, without ever rendering
  // raw server/Zod text in the user's selected language.
  if (field === "name") return t.nameMin;
  if (field === "email") return t.emailInvalid;
  if (field === "subject") return t.subjectMin;
  if (field === "message") return t.messageMin;
  return null;
}

function validateClient(values: Record<string, string>, t: (typeof T)[Locale]) {
  const errors: Record<string, string> = {};
  if (!values.name || values.name.trim().length < 2) errors.name = t.nameMin;
  else if (values.name.trim().length > 100) errors.name = t.nameMax;
  if (!values.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = t.emailInvalid;
  else if (values.email.trim().length > 254) errors.email = t.emailMax;
  if (!values.subject || values.subject.trim().length < 2) errors.subject = t.subjectMin;
  else if (values.subject.trim().length > 200) errors.subject = t.subjectMax;
  if (!values.message || values.message.trim().length < 10) errors.message = t.messageMin;
  if (values.message && values.message.length > 4000) errors.message = t.messageMax;
  return errors;
}

type ContactValues = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

export function ContactForm({
  locale,
  initialValues,
  topic,
}: {
  locale: Locale;
  initialValues?: Partial<ContactValues>;
  topic?: typeof LEARNING_INTEREST_TOPIC;
}) {
  const isLearningInterest = topic === LEARNING_INTEREST_TOPIC;
  const learningCopy = locale === "ar" ? {
    experience: "خبرتك الحالية", experiencePlaceholder: "اختَر الأقرب لمستواك", experienceError: "اختَر مستواك الحالي.",
    availability: "الوقت المتاح للدراسة", availabilityPlaceholder: "مثلًا: 3 ساعات بالأسبوع، مساءً بتوقيت إسرائيل", availabilityError: "اكتب الوقت المتاح للدراسة، من حرفين إلى 160 حرفًا.",
  } : {
    experience: "Your current experience", experiencePlaceholder: "Choose the closest match", experienceError: "Choose your current experience.",
    availability: "Available study time", availabilityPlaceholder: "For example: 3 hours a week, evenings (Israel time)", availabilityError: "Describe your available study time in 2–160 characters.",
  };
  const t = isLearningInterest ? {
    ...T[locale],
    formTitle: locale === "ar" ? "استفسر عن ICT Mentorship" : "Ask about ICT Mentorship",
    message: locale === "ar" ? "هدفك وأسئلتك" : "Your learning goal and questions",
    messagePlaceholder: locale === "ar" ? "شو حاب تفهم أو تطوّر؟ أي سوق بهمّك؟ احكِ عن صعوبة بالتطبيق أو سؤال عندك. لا ترسل أرصدة أو تفاصيل مالية أو كلمات مرور." : "What would you like to understand or improve? Which market interests you? Share a difficulty or a question. Do not include balances, financial details or passwords.",
    send: locale === "ar" ? "إرسال استفسار المنتورشيب" : "Send mentorship enquiry",
    successTitle: locale === "ar" ? "تم تسجيل اهتمامك" : "Your interest has been recorded",
    successBody: locale === "ar" ? "حُفظ استفسارك عن ICT Mentorship ليراجعه مارك. الرد على الاستفسار بيكون عبر البريد الإلكتروني اللي كتبته. هذا ليس حجزًا أو التزامًا بالدفع. اسمع شرح مارك أو ابدأ الأكاديمية المجانية أثناء انتظار الرد." : "Your ICT Mentorship enquiry has been saved for Mark to review. Replies to your enquiry use the email address you provided. This is not a booking or payment commitment. Hear Mark’s explanation or start the free Academy while awaiting a reply.",
  } : T[locale] ?? T.en;
  const isRtl = locale === "ar";

  const uid = useId();
  const nameId = `${uid}-name`;
  const emailId = `${uid}-email`;
  const subjectId = `${uid}-subject`;
  const messageId = `${uid}-message`;
  const experienceId = `${uid}-experience`;
  const availabilityId = `${uid}-availability`;

  const [values, setValues] = useState<ContactValues>(() => ({
    name: initialValues?.name ?? "",
    email: initialValues?.email ?? "",
    subject: isLearningInterest ? LEARNING_INTEREST_SUBJECT[locale] : initialValues?.subject ?? "",
    message: initialValues?.message ?? "",
  }));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [intakeClosed, setIntakeClosed] = useState(false);
  const [learningDetails, setLearningDetails] = useState<{ experience: LearningDetails["experience"] | ""; availability: string }>({ experience: "", availability: "" });
  const honeypotRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  const setLearning = (field: "experience" | "availability") => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.value;
    setLearningDetails(prev => ({ ...prev, [field]: value }));
    setFieldErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValues((prev) => ({ ...prev, [field]: e.target.value }));
    if (fieldErrors[field]) setFieldErrors((prev) => { const next = { ...prev }; delete next[field]; return next; });
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current || intakeClosed) return;

    const errors = validateClient(values, t);
    if (isLearningInterest) {
      if (!learningDetails.experience || !Object.hasOwn(LEARNING_EXPERIENCE, learningDetails.experience)) errors.experience = learningCopy.experienceError;
      const length = learningDetails.availability.trim().length;
      if (length < 2 || length > 160) errors.availability = learningCopy.availabilityError;
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setStatus("error");
      setErrorMsg(t.errorValidation);
      return;
    }

    submittingRef.current = true;
    setStatus("loading");
    setErrorMsg("");
    setFieldErrors({});

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Locale": locale },
        body: JSON.stringify({
          ...values,
          name: values.name.trim(),
          email: values.email.trim(),
          subject: values.subject.trim(),
          message: values.message.trim(),
          locale,
          ...(topic ? { topic } : {}),
          ...(isLearningInterest ? { campaignLinkId: readLearningCampaign(window), learningDetails: { ...learningDetails, availability: learningDetails.availability.trim() } } : {}),
          website: honeypotRef.current?.value ?? "",
        }),
      });

      if (isLearningInterest && res.status === 409) {
        const data = await res.json().catch(() => ({}));
        if (data.error === "mentorship_intake_closed") {
          setIntakeClosed(true);
          setStatus("error");
          setErrorMsg(locale === "ar" ? "انتهت نافذة استقبال طلبات ICT Mentorship لعام 2026. الأكاديمية المجانية ما زالت متاحة." : "The 2026 ICT Mentorship enquiry window has closed. The free Academy remains available.");
          return;
        }
      }

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
            const code = Array.isArray(msgs) ? msgs[0] : undefined;
            const localized = isLearningInterest && k === "experience" ? learningCopy.experienceError
              : isLearningInterest && k === "availability" ? learningCopy.availabilityError
                : localizeContactIssue(k, code, t);
            if (localized) mapped[k] = localized;
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
      setValues({ name: "", email: "", subject: isLearningInterest ? LEARNING_INTEREST_SUBJECT[locale] : "", message: "" });
      setLearningDetails({ experience: "", availability: "" });
    } catch {
      setStatus("error");
      setErrorMsg(t.errorGeneric);
    } finally {
      submittingRef.current = false;
    }
  }

  if (status === "success") {
    return (
      <ActionFeedback className="mt-8 flex max-w-3xl flex-col items-center gap-4 rounded-2xl border border-[#C9A227]/30 bg-[#C9A227]/5 p-8 text-center">
        <CheckCircle2 className="h-12 w-12 text-[#C9A227]" aria-hidden="true" />
        <h2 className="text-xl font-semibold text-white">{t.successTitle}</h2>
        <p className="text-sm text-white/70">{t.successBody}</p>
        {isLearningInterest ? <a href={`/${locale}/learn-with-mark#mark-explains`} className="text-sm text-[#C9A227] underline underline-offset-4">{locale === "ar" ? "اسمع شرح مارك · 7:44" : "Hear Mark’s explanation · 7:44"}</a> : null}
        {isLearningInterest ? <a href={`/${locale}/learn-trading-free`} className="text-sm text-[#C9A227] underline underline-offset-4">{locale === "ar" ? "استكشف الأكاديمية المجانية" : "Explore the Free Academy"}</a> : null}
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-2 text-sm text-[#C9A227] underline underline-offset-2 hover:opacity-80"
        >
          {locale === "ar" ? "إرسال رسالة أخرى" : "Send another message"}
        </button>
      </ActionFeedback>
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
      {isLearningInterest ? <p className="text-sm leading-7 text-white/70">{locale === "ar" ? "اكتب مستواك وهدفك ووقتك المتاح. بيانات الطلب يطّلع عليها المالك للرد على استفسارك، ولا تظهر للزوار. قد يُرفق رمز رابط الحملة لمعرفة أي محتوى جلب الاهتمام، مع احترام عدم التتبع. إرسال الطلب لا يضيفك تلقائيًا إلى نشرة تسويقية." : "Share your level, learning goal and availability. The owner can review your details to respond; they are not public. A campaign link code may accompany your enquiry to understand which content brought interest, respecting tracking opt-outs. Submitting does not automatically subscribe you to marketing."}</p> : null}

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
          maxLength={100}
          value={values.name}
          onChange={set("name")}
          disabled={status === "loading"}
          aria-invalid={!!fieldErrors.name}
          aria-describedby={fieldErrors.name ? `${nameId}-err` : undefined}
          required
        />
        {fieldErrors.name && (
          <ActionFeedback as="p" role="alert" id={`${nameId}-err`}  className="flex items-center gap-1 text-xs text-red-400">
            <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            {fieldErrors.name}
          </ActionFeedback>
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
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          placeholder={t.emailPlaceholder}
          maxLength={254}
          value={values.email}
          onChange={set("email")}
          disabled={status === "loading"}
          aria-invalid={!!fieldErrors.email}
          aria-describedby={[isLearningInterest ? `${emailId}-hint` : "", fieldErrors.email ? `${emailId}-err` : ""].filter(Boolean).join(" ") || undefined}
          required
        />
        {isLearningInterest ? <p id={`${emailId}-hint`} className="text-xs leading-6 text-white/60">{locale === "ar" ? "استخدم بريدًا بتقدر تفتحه؛ الرد على استفسارك بيكون من خلاله. ما بتحتاج حساب بالموقع." : "Use an email you can access; replies to your enquiry go here. No website account is needed."}</p> : null}
        {fieldErrors.email && (
          <ActionFeedback as="p" role="alert" id={`${emailId}-err`}  className="flex items-center gap-1 text-xs text-red-400">
            <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            {fieldErrors.email}
          </ActionFeedback>
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
          readOnly={isLearningInterest}
          type="text"
          placeholder={t.subjectPlaceholder}
          maxLength={200}
          value={isLearningInterest ? (locale === "ar" ? "ICT Mentorship مع مارك" : "ICT Mentorship with Mark") : values.subject}
          onChange={set("subject")}
          disabled={status === "loading"}
          aria-invalid={!!fieldErrors.subject}
          aria-describedby={fieldErrors.subject ? `${subjectId}-err` : undefined}
          required
        />
        {fieldErrors.subject && (
          <ActionFeedback as="p" role="alert" id={`${subjectId}-err`}  className="flex items-center gap-1 text-xs text-red-400">
            <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            {fieldErrors.subject}
          </ActionFeedback>
        )}
      </div>

      {isLearningInterest ? <fieldset disabled={status === "loading"} className="grid min-w-0 gap-5">
        <legend className="sr-only">{locale === "ar" ? "عن تعلّمك" : "About your learning"}</legend>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor={experienceId} className="text-sm text-white/60">{learningCopy.experience} <span className="text-[#C9A227]">*</span></label>
          <select id={experienceId} name="experience" value={learningDetails.experience} onChange={setLearning("experience")} required aria-invalid={!!fieldErrors.experience} aria-describedby={fieldErrors.experience ? `${experienceId}-err` : undefined} className="min-h-11 w-full min-w-0 rounded-xl border border-white/15 bg-[#111] px-3 py-3 text-base text-white focus:border-[#C9A227] focus:outline-none focus:ring-2 focus:ring-[#C9A227]/30">
            <option value="">{learningCopy.experiencePlaceholder}</option>
            {Object.entries(LEARNING_EXPERIENCE).map(([value, label]) => <option key={value} value={value}>{label[locale]}</option>)}
          </select>
          {fieldErrors.experience ? <ActionFeedback as="p" role="alert" id={`${experienceId}-err`} className="text-xs text-red-400">{fieldErrors.experience}</ActionFeedback> : null}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={availabilityId} className="text-sm text-white/60">{learningCopy.availability} <span className="text-[#C9A227]">*</span></label>
          <Input id={availabilityId} name="availability" value={learningDetails.availability} onChange={setLearning("availability")} placeholder={learningCopy.availabilityPlaceholder} maxLength={160} required aria-invalid={!!fieldErrors.availability} aria-describedby={fieldErrors.availability ? `${availabilityId}-err` : undefined} />
          {fieldErrors.availability ? <ActionFeedback as="p" role="alert" id={`${availabilityId}-err`} className="text-xs text-red-400">{fieldErrors.availability}</ActionFeedback> : null}
        </div>
      </fieldset> : null}

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
          maxLength={4000}
          required
        />
        <div className={`flex items-center gap-1 ${fieldErrors.message ? "justify-between" : "justify-end"}`}>
          {fieldErrors.message && (
            <ActionFeedback as="p" role="alert" id={`${messageId}-err`}  className="flex items-center gap-1 text-xs text-red-400">
              <AlertCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
              {fieldErrors.message}
            </ActionFeedback>
          )}
          <span className="text-xs text-white/30" aria-live="polite">
            {values.message.length}/4000
          </span>
        </div>
      </div>

      {/* Global error banner */}
      {status === "error" && errorMsg && !Object.keys(fieldErrors).length && (
        <ActionFeedback as="p" role="alert" className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          {errorMsg}
        </ActionFeedback>
      )}

      {intakeClosed ? <a href={`/${locale}/learn-trading-free`} className="text-sm text-[#C9A227] underline">{locale === "ar" ? "استكشف الأكاديمية المجانية" : "Explore the Free Academy"}</a> : null}
      <Button type="submit" disabled={status === "loading" || intakeClosed} className="gap-2 self-start">
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
