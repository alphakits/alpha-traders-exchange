import Image from "next/image";
import { ExternalLink, Mail, MessageCircle, Music2 } from "lucide-react";
import type { AppLocale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";

const SOCIAL = {
  whatsapp: "https://wa.me/972525967649",
  instagram: "https://www.instagram.com/mark_jozen/",
  tiktok: "https://www.tiktok.com/@mark_jozen",
  email: "mailto:support@alphatraders.co.il",
};

export async function SiteFooter({ locale }: { locale: AppLocale }) {
  const year = new Date().getFullYear();
  const isAr = locale === "ar";

  return (
    <footer className="relative overflow-hidden border-t border-[#C9A227]/20 bg-[#030303]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(201,162,39,0.14),_transparent_50%)]" />

      <div className="section-container relative py-12 md:py-16">
        <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-4">
            <Link href="/" locale={locale} className="inline-flex min-h-11 items-center gap-3 rounded-lg">
              <Image
                src="/images/brand/alpha-traders-logo.webp"
                alt="Alpha Traders"
                width={40}
                height={40}
                className="rounded-full border border-[#C9A227]/45 bg-black/60 object-cover shadow-[0_0_20px_rgba(201,162,39,0.2)]"
              />
              <span className="text-lg font-semibold tracking-wide text-white">Alpha Traders</span>
            </Link>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-[#B2BAC8]">
              {isAr
                ? "منصة مالية عربية تجمع بين التعليم الاحترافي وسوق USDT موثوق بتجربة فاخرة."
                : "A premium Arabic fintech platform combining professional trading education and a trusted USDT marketplace."}
            </p>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A227]">
                {isAr ? "النشرة البريدية" : "Newsletter"}
              </p>
              <p className="mt-2 text-xs text-[#9CA3AF]">
                {isAr
                  ? "احصل على تحديثات السوق والدروس الجديدة مباشرة."
                  : "Get market updates and new learning drops directly in your inbox."}
              </p>
              <a
                href="mailto:support@alphatraders.co.il?subject=Newsletter%20Subscription"
                className="mt-3 inline-flex h-10 items-center justify-center rounded-xl border border-[#C9A227]/35 bg-[#C9A227]/10 px-4 text-sm font-medium text-[#F4D87A] transition-all hover:-translate-y-0.5 hover:bg-[#C9A227]/20"
              >
                {isAr ? "اشترك بالبريد" : "Subscribe by Email"}
              </a>
            </div>

            <div className="mt-5 flex items-center gap-2.5">
              <a
                href={SOCIAL.whatsapp}
                target="_blank"
                rel="noreferrer"
                aria-label="WhatsApp"
                className="group flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-all hover:-translate-y-0.5 hover:border-[#25D366]/50 hover:bg-[#25D366]/10"
              >
                <MessageCircle className="h-4 w-4 text-[#A0A8B6] group-hover:text-[#25D366]" />
              </a>
              <a
                href={SOCIAL.instagram}
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram"
                className="group flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-all hover:-translate-y-0.5 hover:border-[#C9A227]/50 hover:bg-[#C9A227]/10"
              >
                <ExternalLink className="h-4 w-4 text-[#A0A8B6] group-hover:text-[#F4D87A]" />
              </a>
              <a
                href={SOCIAL.tiktok}
                target="_blank"
                rel="noreferrer"
                aria-label="TikTok"
                className="group flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-all hover:-translate-y-0.5 hover:border-[#C9A227]/50 hover:bg-[#C9A227]/10"
              >
                <Music2 className="h-4 w-4 text-[#A0A8B6] group-hover:text-[#F4D87A]" />
              </a>
              <a
                href={SOCIAL.email}
                aria-label="Email"
                className="group flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-all hover:-translate-y-0.5 hover:border-[#C9A227]/50 hover:bg-[#C9A227]/10"
              >
                <Mail className="h-4 w-4 text-[#A0A8B6] group-hover:text-[#F4D87A]" />
              </a>
            </div>
          </div>

          <div className="grid gap-8 sm:grid-cols-2 lg:col-span-8 lg:grid-cols-4">
            <div>
              <h4 className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A227]">
                {isAr ? "المنصة" : "Platform"}
              </h4>
              <ul className="space-y-2.5 text-sm">
                <li><Link href="/academy" locale={locale} className="inline-flex min-h-10 items-center rounded-md px-1 text-[#A9B1BF] transition-colors hover:text-white">{isAr ? "Alpha Academy" : "Alpha Academy"}</Link></li>
                <li><Link href="/usdt-exchange" locale={locale} className="inline-flex min-h-10 items-center rounded-md px-1 text-[#A9B1BF] transition-colors hover:text-white">{isAr ? "Alpha Exchange" : "Alpha Exchange"}</Link></li>
                <li><Link href="/community" locale={locale} className="inline-flex min-h-10 items-center rounded-md px-1 text-[#A9B1BF] transition-colors hover:text-white">{isAr ? "Community" : "Community"}</Link></li>
                <li><Link href="/lessons" locale={locale} className="inline-flex min-h-10 items-center rounded-md px-1 text-[#A9B1BF] transition-colors hover:text-white">{isAr ? "الدروس" : "Lessons"}</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A227]">
                {isAr ? "الشركة" : "Company"}
              </h4>
              <ul className="space-y-2.5 text-sm">
                <li><Link href="/about-founder" locale={locale} className="inline-flex min-h-10 items-center rounded-md px-1 text-[#A9B1BF] transition-colors hover:text-white">{isAr ? "عن المؤسس" : "About Founder"}</Link></li>
                <li><Link href="/founder" locale={locale} className="inline-flex min-h-10 items-center rounded-md px-1 text-[#A9B1BF] transition-colors hover:text-white">{isAr ? "قصة Alpha Traders" : "Founder Story"}</Link></li>
                <li><Link href="/contact" locale={locale} className="inline-flex min-h-10 items-center rounded-md px-1 text-[#A9B1BF] transition-colors hover:text-white">{isAr ? "تواصل معنا" : "Contact"}</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A227]">
                {isAr ? "الحساب" : "Account"}
              </h4>
              <ul className="space-y-2.5 text-sm">
                <li><Link href="/login" locale={locale} className="inline-flex min-h-10 items-center rounded-md px-1 text-[#A9B1BF] transition-colors hover:text-white">{isAr ? "تسجيل الدخول" : "Sign In"}</Link></li>
                <li><Link href="/register" locale={locale} className="inline-flex min-h-10 items-center rounded-md px-1 text-[#A9B1BF] transition-colors hover:text-white">{isAr ? "إنشاء حساب" : "Create Account"}</Link></li>
                <li><Link href="/profile" locale={locale} className="inline-flex min-h-10 items-center rounded-md px-1 text-[#A9B1BF] transition-colors hover:text-white">{isAr ? "الملف الشخصي" : "Profile"}</Link></li>
                <li><Link href="/settings" locale={locale} className="inline-flex min-h-10 items-center rounded-md px-1 text-[#A9B1BF] transition-colors hover:text-white">{isAr ? "الإعدادات" : "Settings"}</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-[#C9A227]">
                {isAr ? "قانوني" : "Legal"}
              </h4>
              <ul className="space-y-2.5 text-sm">
                <li><Link href="/privacy-policy" locale={locale} className="inline-flex min-h-10 items-center rounded-md px-1 text-[#A9B1BF] transition-colors hover:text-white">{isAr ? "سياسة الخصوصية" : "Privacy Policy"}</Link></li>
                <li><Link href="/terms" locale={locale} className="inline-flex min-h-10 items-center rounded-md px-1 text-[#A9B1BF] transition-colors hover:text-white">{isAr ? "الشروط والأحكام" : "Terms of Service"}</Link></li>
                <li><Link href="/cookies" locale={locale} className="inline-flex min-h-10 items-center rounded-md px-1 text-[#A9B1BF] transition-colors hover:text-white">{isAr ? "سياسة ملفات الارتباط" : "Cookie Policy"}</Link></li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="relative border-t border-white/10">
        <div className="section-container flex flex-col gap-3 py-5 text-xs text-[#6B7280] sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} Alpha Traders. {isAr ? "جميع الحقوق محفوظة." : "All rights reserved."}</p>
          <p className="text-[#C9A227]/70">{isAr ? "منصة موثوقة لتداول منضبط." : "Built for disciplined, secure trading."}</p>
        </div>
      </div>
    </footer>
  );
}
