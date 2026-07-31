import Image from "next/image";
import { MessageCircle, Music2, Mail, ExternalLink } from "lucide-react";
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
    <footer className="border-t border-[#C9A227]/15 bg-[#050505]">
      {/* Main footer body */}
      <div className="section-container py-12 md:py-16">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">

          {/* Brand column */}
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" locale={locale} className="inline-flex items-center gap-3">
              <Image
                src="/images/brand/alpha-traders-logo.png"
                alt="Alpha Traders"
                width={36}
                height={36}
                className="rounded-full border border-[#C9A227]/40 bg-black/40 p-0.5 object-cover shadow-[0_0_12px_rgba(201,162,39,0.2)]"
              />
              <span className="text-base font-semibold tracking-wide text-white">Alpha Traders</span>
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-[#6B7280]">
              {isAr
                ? "منصة تداول عربية متكاملة — تعليم احترافي مجاني وسوق USDT موثوق."
                : "The premium Arabic trading platform — free professional education and a trusted USDT marketplace."}
            </p>
            {/* Social icons */}
            <div className="mt-5 flex items-center gap-3">
              <a href={SOCIAL.whatsapp} target="_blank" rel="noreferrer"
                aria-label="WhatsApp"
                className="group flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-colors hover:border-[#25D366]/50 hover:bg-[#25D366]/10">
                <MessageCircle className="h-4 w-4 text-[#9CA3AF] group-hover:text-[#25D366]" />
              </a>
              <a href={SOCIAL.instagram} target="_blank" rel="noreferrer"
                aria-label="Instagram"
                className="group flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-colors hover:border-[#C9A227]/50 hover:bg-[#C9A227]/10">
                <ExternalLink className="h-4 w-4 text-[#9CA3AF] group-hover:text-[#C9A227]" />
              </a>
              <a href={SOCIAL.tiktok} target="_blank" rel="noreferrer"
                aria-label="TikTok"
                className="group flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-colors hover:border-[#C9A227]/50 hover:bg-[#C9A227]/10">
                <Music2 className="h-4 w-4 text-[#9CA3AF] group-hover:text-[#C9A227]" />
              </a>
              <a href={SOCIAL.email} aria-label="Email"
                className="group flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 transition-colors hover:border-[#C9A227]/50 hover:bg-[#C9A227]/10">
                <Mail className="h-4 w-4 text-[#9CA3AF] group-hover:text-[#C9A227]" />
              </a>
            </div>
          </div>

          {/* Platform column */}
          <div>
            <h4 className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#C9A227]">
              {isAr ? "المنصة" : "Platform"}
            </h4>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link href="/academy" locale={locale} className="text-[#9CA3AF] transition-colors hover:text-white">
                  {isAr ? "أكاديمية ألفا" : "Alpha Academy"}
                </Link>
              </li>
              <li>
                <Link href="/usdt-exchange" locale={locale} className="text-[#9CA3AF] transition-colors hover:text-white">
                  {isAr ? "سوق USDT" : "USDT Exchange"}
                </Link>
              </li>
              <li>
                <Link href="/community" locale={locale} className="text-[#9CA3AF] transition-colors hover:text-white">
                  {isAr ? "المجتمع" : "Community"}
                </Link>
              </li>
              <li>
                <Link href="/lessons" locale={locale} className="text-[#9CA3AF] transition-colors hover:text-white">
                  {isAr ? "الدروس" : "Lessons"}
                </Link>
              </li>
            </ul>
          </div>

          {/* Company column */}
          <div>
            <h4 className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#C9A227]">
              {isAr ? "الشركة" : "Company"}
            </h4>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link href="/about-founder" locale={locale} className="text-[#9CA3AF] transition-colors hover:text-white">
                  {isAr ? "عن المؤسس" : "About the Founder"}
                </Link>
              </li>
              <li>
                <Link href="/contact" locale={locale} className="text-[#9CA3AF] transition-colors hover:text-white">
                  {isAr ? "تواصل معنا" : "Contact Us"}
                </Link>
              </li>
              <li>
                <a href={SOCIAL.whatsapp} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-[#9CA3AF] transition-colors hover:text-[#25D366]">
                  <MessageCircle className="h-3.5 w-3.5" />
                  {isAr ? "واتساب المباشر" : "Direct WhatsApp"}
                  <ExternalLink className="h-3 w-3 opacity-50" />
                </a>
              </li>
            </ul>
          </div>

          {/* Account / Legal column */}
          <div>
            <h4 className="mb-4 text-xs font-semibold uppercase tracking-widest text-[#C9A227]">
              {isAr ? "الحساب" : "Account"}
            </h4>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link href="/login" locale={locale} className="text-[#9CA3AF] transition-colors hover:text-white">
                  {isAr ? "تسجيل الدخول" : "Sign In"}
                </Link>
              </li>
              <li>
                <Link href="/register" locale={locale} className="text-[#9CA3AF] transition-colors hover:text-white">
                  {isAr ? "إنشاء حساب" : "Create Account"}
                </Link>
              </li>
              <li>
                <Link href="/profile" locale={locale} className="text-[#9CA3AF] transition-colors hover:text-white">
                  {isAr ? "الملف الشخصي" : "My Profile"}
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/5">
        <div className="section-container flex flex-col gap-3 py-5 text-xs text-[#4B5563] sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} Alpha Traders.{" "}
            {isAr ? "جميع الحقوق محفوظة." : "All rights reserved."}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-[#C9A227]/60">
              {isAr ? "مُصمَّم للتداول الجاد." : "Built for disciplined trading."}
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
