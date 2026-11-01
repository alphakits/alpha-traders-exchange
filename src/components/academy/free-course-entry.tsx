"use client";

import { getInterfaceAccess } from "@alpha-traders/contracts";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";
import { Link } from "@/i18n/navigation";

export function FreeCourseEntryLink({ locale, className }: { locale: "ar" | "en"; className?: string }) {
  const user = useOptionalCanonicalSession()?.user ?? null;
  const isStudent = getInterfaceAccess(user).student;
  const href = user ? "/academy" : { pathname: "/login", query: { redirectTo: `/${locale}/academy` } };
  return <Link href={href} className={className}>
    {isStudent
      ? (locale === "ar" ? "تابع الدورة المجانية" : "Continue the Free Course")
      : (locale === "ar" ? "ابدأ الدورة المجانية" : "Start the Free Course")}
  </Link>;
}

export function FreeCourseAccessNote({ locale }: { locale: "ar" | "en" }) {
  const user = useOptionalCanonicalSession()?.user ?? null;
  const isAr = locale === "ar";
  const accountNote = user
    ? user.emailVerified
      ? (isAr ? "حسابك جاهز للدخول إلى الدروس وحفظ تقدّمك." : "Your account is ready to access lessons and save your progress.")
      : (isAr ? "أكّد بريدك الإلكتروني للوصول إلى الدروس وحفظ تقدّمك." : "Verify your email to access lessons and save your progress.")
    : (isAr ? "أنشئ حسابًا أو سجّل الدخول، ثم أكّد بريدك للوصول إلى الدروس وحفظ تقدّمك." : "Create an account or sign in, then verify your email to access lessons and save progress.");
  return <p className="text-sm leading-7 text-[#D1D5DB]">
    {accountNote} {isAr ? "المحتوى تعليمي والتداول ينطوي على مخاطر؛ لا توجد أرباح مضمونة." : "Content is educational and trading involves risk; profits are never guaranteed."}
  </p>;
}

export function FreeCourseSetupSteps({ locale }: { locale: "ar" | "en" }) {
  const user = useOptionalCanonicalSession()?.user ?? null;
  const isAr = locale === "ar";
  return <ol className="mt-4 space-y-3 text-sm leading-7 text-[#D1D5DB]">
    <li>{isAr ? "1. استكشف المراحل والمواضيع في هذه الصفحة." : "1. Review the stages and topics on this page."}</li>
    <li>{user
      ? (isAr ? "2. افتح الأكاديمية من حسابك الحالي." : "2. Open the Academy from your current account.")
      : (isAr ? "2. أنشئ حسابًا باستخدام بريدك الإلكتروني أو سجّل الدخول." : "2. Create an account with your email or sign in.")}</li>
    <li>{user?.emailVerified
      ? (isAr ? "3. تابع الدروس واحفظ تقدّمك في حسابك." : "3. Continue the lessons and save progress in your account.")
      : (isAr ? "3. أكد بريدك الإلكتروني للدخول إلى الدروس وحفظ تقدمك." : "3. Verify your email to access lessons and save progress.")}</li>
    <li>{isAr ? "4. تابع التعلم بالترتيب وركز على إدارة المخاطر قبل التطبيق." : "4. Follow the learning path in order and prioritize risk management before execution."}</li>
  </ol>;
}
