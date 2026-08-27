import Image from "next/image";
import {
  Activity,
  Bell,
  CheckCircle2,
  ExternalLink,
  FileText,
  GraduationCap,
  Landmark,
  Lock,
  Mail,
  MessageCircle,
  Music2,
  Settings,
  ShieldCheck,
  Store,
  UserCircle2,
} from "lucide-react";
import type { ComponentType } from "react";
import type { AppLocale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";
import { getOfficialOwnerWhatsAppUrl } from "@/lib/official-contact";
import { BRAND_DESCRIPTOR, BRAND_DESCRIPTOR_AR, BRAND_NAME, BRAND_PRIMARY_NAME } from "@/lib/brand";

type FooterItem = {
  href: string;
  en: string;
  ar: string;
  icon: ComponentType<{ className?: string }>;
};

type FooterSection = {
  id: string;
  en: string;
  ar: string;
  items: FooterItem[];
};

const SOCIAL = {
  instagram: "https://www.instagram.com/mark_jozen/",
  tiktok: "https://www.tiktok.com/@mark_jozen",
  discord: "https://discord.gg/alphatraders",
};

const MARKETPLACE_SECTION: FooterSection = {
  id: "marketplace",
  en: "Marketplace",
  ar: "السوق",
  items: [
    { href: "/usdt-exchange?mode=buy#marketplace-sellers", en: "Buy USDT", ar: "شراء USDT", icon: Store },
    { href: "/usdt-exchange?mode=sell#create-listing", en: "Sell USDT", ar: "بيع USDT", icon: Store },
    { href: "/usdt-exchange?approved=1&sort=trust-desc#marketplace-sellers", en: "Approved Sellers", ar: "البائعون المعتمدون", icon: ShieldCheck },
    { href: "/usdt-exchange?sort=trust-desc", en: "Seller Rankings", ar: "ترتيب البائعين", icon: Activity },
    { href: "/trade-room", en: "Trade Room", ar: "غرفة التداول", icon: MessageCircle },
    { href: "/safety-trust", en: "Safety Center", ar: "مركز الأمان", icon: ShieldCheck },
    { href: "/safety-trust#escrow", en: "Escrow Protection", ar: "حماية الضمان", icon: Lock },
    { href: "/usdt-exchange#market-overview", en: "Market Status (LIVE)", ar: "حالة السوق (مباشر)", icon: Activity },
  ],
};

const LEARN_SECTION: FooterSection = {
  id: "learn",
  en: "Academy",
  ar: "الأكاديمية",
  items: [
    { href: "/academy#courses-overview", en: "Trading Courses", ar: "دورات التداول", icon: GraduationCap },
    { href: "/lessons#beginner-guides", en: "Beginner Guides", ar: "أدلة المبتدئين", icon: FileText },
    { href: "/lessons#advanced-strategies", en: "Advanced Strategies", ar: "استراتيجيات متقدمة", icon: Activity },
    { href: "/lessons#risk-management", en: "Risk Management", ar: "إدارة المخاطر", icon: ShieldCheck },
    { href: "/lessons#trading-psychology", en: "Trading Psychology", ar: "علم نفس التداول", icon: UserCircle2 },
    { href: "/community#market-news", en: "Market News", ar: "أخبار السوق", icon: Activity },
    { href: "/help-center#faq", en: "FAQ", ar: "الأسئلة الشائعة", icon: MessageCircle },
  ],
};

const COMPANY_SECTION: FooterSection = {
  id: "company",
  en: "Company",
  ar: "الشركة",
  items: [
    { href: "/about-founder", en: "About Alpha Traders", ar: "عن Alpha Traders", icon: ExternalLink },
    { href: "/founder", en: "Founder", ar: "المؤسس", icon: UserCircle2 },
    { href: "/contact", en: "Contact", ar: "تواصل معنا", icon: Mail },
    { href: "/community", en: "Community", ar: "المجتمع", icon: MessageCircle },
    { href: "/help-center", en: "Help Center", ar: "مركز المساعدة", icon: MessageCircle },
    { href: "/report-abuse", en: "Report Abuse", ar: "الإبلاغ عن إساءة", icon: ShieldCheck },
    { href: "/support", en: "Support", ar: "الدعم", icon: Mail },
  ],
};

const ACCOUNT_SECTION: FooterSection = {
  id: "account",
  en: "Account",
  ar: "الحساب",
  items: [
    { href: "/register", en: "Create Account", ar: "إنشاء حساب", icon: UserCircle2 },
    { href: "/login", en: "Login", ar: "تسجيل الدخول", icon: Lock },
    { href: "/profile", en: "Profile", ar: "الملف الشخصي", icon: UserCircle2 },
    { href: "/dashboard", en: "Dashboard", ar: "لوحة التحكم", icon: Activity },
    { href: "/dashboard/seller", en: "Seller Dashboard", ar: "لوحة البائع", icon: Store },
    { href: "/settings", en: "Settings", ar: "الإعدادات", icon: Settings },
    { href: "/settings#notifications", en: "Notifications", ar: "الإشعارات", icon: Bell },
  ],
};

const LEGAL_SECTION: FooterSection = {
  id: "legal",
  en: "Legal",
  ar: "قانوني",
  items: [
    { href: "/privacy-policy", en: "Privacy Policy", ar: "سياسة الخصوصية", icon: FileText },
    { href: "/terms", en: "Terms", ar: "الشروط", icon: FileText },
    { href: "/cookies", en: "Cookies", ar: "الكوكيز", icon: FileText },
    { href: "/terms#aml-policy", en: "AML Policy", ar: "سياسة AML", icon: Landmark },
    { href: "/terms#kyc-policy", en: "KYC Policy", ar: "سياسة KYC", icon: ShieldCheck },
    { href: "/safety-trust", en: "Safety", ar: "الأمان", icon: ShieldCheck },
    { href: "/terms#compliance-policy", en: "Compliance", ar: "الامتثال", icon: Lock },
  ],
};

const NAV_SECTIONS = [MARKETPLACE_SECTION, LEARN_SECTION, COMPANY_SECTION, ACCOUNT_SECTION, LEGAL_SECTION];

const TRUST_POINTS = [
  { en: "SSL Secured", ar: "حماية SSL" },
  { en: "Escrow Protected", ar: "ضمان محمي" },
  { en: "Verified Marketplace", ar: "سوق موثوق" },
  { en: "24/7 Support", ar: "دعم 24/7" },
  { en: "Fast Transactions", ar: "معاملات سريعة" },
];

function FooterNavSection({ section, locale }: { section: FooterSection; locale: AppLocale }) {
  const isAr = locale === "ar";
  return (
    <div className="space-y-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#D4AF37]">
        {isAr ? section.ar : section.en}
      </h4>
      <ul className="space-y-2">
        {section.items.map((item) => {
          const Icon = item.icon;
          return (
            <li key={`${section.id}-${item.en}`}>
              <Link
                href={item.href}
                locale={locale}
                className="group inline-flex items-center gap-2 text-sm text-[#B9C0CD] transition-colors hover:text-white"
              >
                <Icon className="h-3.5 w-3.5 text-[#C9A227]/80 transition-transform duration-200 group-hover:translate-x-0.5" />
                <span className="relative">
                  {isAr ? item.ar : item.en}
                  <span className="pointer-events-none absolute -bottom-0.5 left-0 h-px w-full origin-left scale-x-0 bg-[#C9A227]/80 transition-transform duration-200 group-hover:scale-x-100" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export async function SiteFooter({ locale }: { locale: AppLocale }) {
  const whatsappUrl = getOfficialOwnerWhatsAppUrl();
  const isAr = locale === "ar";
  const year = new Date().getFullYear();
  return (
    <footer className="relative overflow-hidden border-t border-[#C9A227]/25 bg-[#020202]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_8%,rgba(201,162,39,0.16),transparent_42%),radial-gradient(circle_at_78%_30%,rgba(102,153,255,0.12),transparent_38%),radial-gradient(circle_at_68%_80%,rgba(201,162,39,0.1),transparent_46%)]" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(212,175,55,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(212,175,55,0.16)_1px,transparent_1px)] [background-size:34px_34px]" />
        <svg className="absolute inset-0 h-full w-full opacity-[0.13]" viewBox="0 0 1200 320" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 214C110 186 226 178 338 190C430 200 516 230 608 222C712 214 806 168 912 158C1012 148 1112 176 1200 210V320H0Z" fill="url(#footerMap)" />
          <path d="M40 122L240 108L420 132L604 92L790 126L982 82L1162 106" fill="none" stroke="rgba(212,175,55,0.35)" strokeWidth="1.4" />
          <path d="M54 210L248 186L452 218L658 176L846 202L1030 168L1172 194" fill="none" stroke="rgba(121,166,255,0.26)" strokeWidth="1.2" />
          <defs>
            <linearGradient id="footerMap" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(212,175,55,0.16)" />
              <stop offset="100%" stopColor="rgba(65,98,168,0.04)" />
            </linearGradient>
          </defs>
        </svg>
        <span className="absolute left-[8%] top-[20%] h-1 w-1 rounded-full bg-[#C9A227] opacity-50 animate-pulse" />
        <span className="absolute left-[27%] top-[74%] h-1.5 w-1.5 rounded-full bg-[#D4AF37] opacity-45 animate-pulse" />
        <span className="absolute left-[62%] top-[30%] h-1 w-1 rounded-full bg-[#C9A227] opacity-40 animate-pulse" />
        <span className="absolute left-[84%] top-[62%] h-1.5 w-1.5 rounded-full bg-[#D4AF37] opacity-45 animate-pulse" />
      </div>

      <div className="section-container relative py-14 md:py-16">
        <div className="grid gap-8 md:hidden">
          <div className="rounded-3xl border border-white/10 bg-black/30 p-5">
            <Link href="/" locale={locale} className="inline-flex items-center gap-3">
              <Image
                src="/images/brand/alpha-traders-logo.webp"
                alt={isAr ? `شعار ${BRAND_PRIMARY_NAME}` : `${BRAND_NAME} logo`}
                width={84}
                height={84}
                className="rounded-2xl border border-[#C9A227]/45 bg-black/35 object-cover shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
              />
              <div>
                <p className="gold-gradient inline-block bg-clip-text pb-px text-[1.02rem] font-semibold leading-[1.15] tracking-wide text-transparent">
                  {BRAND_PRIMARY_NAME}
                </p>
                <p className="text-xs text-[#D4AF37]">
                  {isAr ? BRAND_DESCRIPTOR_AR : BRAND_DESCRIPTOR}
                </p>
              </div>
            </Link>
            <p className="mt-3 text-sm text-[#BFC6D2]">
              {isAr
                ? "أكاديمية تداول احترافية وسوق USDT موثوق. موثوق من مجتمعنا المتنامي من المتداولين."
                : "Professional Trading Education • Trusted USDT Marketplace. Trusted by our growing community of traders."}
            </p>
            <div className="mt-4 grid grid-cols-1 gap-2 text-sm text-[#D5DBE6]">
              {[
                isAr ? "سوق آمن" : "Secure Marketplace",
                isAr ? "ضمان محمي" : "Escrow Protected",
                isAr ? "بائعون موثقون" : "Verified Sellers",
                isAr ? "مدعوم بالمجتمع" : "Community Driven",
              ].map((point) => (
                <p key={point} className="inline-flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#D4AF37]" />
                  <span>{point}</span>
                </p>
              ))}
            </div>
          </div>

          {NAV_SECTIONS.map((section) => (
            <details key={`mobile-${section.id}`} className="group rounded-2xl border border-white/10 bg-black/30 p-4">
              <summary className="cursor-pointer list-none text-sm font-semibold text-white">
                <span className="inline-flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#D4AF37]" />
                  {isAr ? section.ar : section.en}
                </span>
              </summary>
              <div className="mt-3 border-t border-white/10 pt-3">
                <FooterNavSection section={section} locale={locale} />
              </div>
            </details>
          ))}
        </div>

        <div className="hidden gap-8 md:grid md:grid-cols-3 xl:grid-cols-6">
          <div className="xl:col-span-1">
            <Link href="/" locale={locale} className="inline-flex items-center gap-3">
              <Image
                src="/images/brand/alpha-traders-logo.webp"
                alt={isAr ? `شعار ${BRAND_PRIMARY_NAME}` : `${BRAND_NAME} logo`}
                width={84}
                height={84}
                className="rounded-2xl border border-[#C9A227]/45 bg-black/35 object-cover shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
              />
              <div>
                <p className="gold-gradient inline-block bg-clip-text pb-px text-[1.02rem] font-semibold leading-[1.15] tracking-wide text-transparent">
                  {BRAND_PRIMARY_NAME}
                </p>
                <p className="text-xs text-[#D4AF37]">
                  {isAr ? BRAND_DESCRIPTOR_AR : BRAND_DESCRIPTOR}
                </p>
              </div>
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-[#BFC6D2]">
              {isAr
                ? "أكاديمية تداول احترافية وسوق USDT موثوق. موثوق من مجتمعنا المتنامي من المتداولين."
                : "Professional Trading Education • Trusted USDT Marketplace. Trusted by our growing community of traders."}
            </p>
            <div className="mt-4 space-y-2 text-sm text-[#D5DBE6]">
              {[
                isAr ? "سوق آمن" : "Secure Marketplace",
                isAr ? "ضمان محمي" : "Escrow Protected",
                isAr ? "بائعون موثقون" : "Verified Sellers",
                isAr ? "مدعوم بالمجتمع" : "Community Driven",
              ].map((point) => (
                <p key={point} className="inline-flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-[#D4AF37]" />
                  <span>{point}</span>
                </p>
              ))}
            </div>
          </div>

          {NAV_SECTIONS.map((section) => (
            <FooterNavSection key={`desktop-${section.id}`} section={section} locale={locale} />
          ))}
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/35 p-5 shadow-[0_10px_24px_rgba(0,0,0,0.28)]">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#D4AF37]">
              {isAr ? "النشرة البريدية" : "Newsletter"}
            </p>
            <p className="mt-3 text-lg font-semibold text-white">
              {isAr ? "ابقَ متقدمًا على السوق." : "Stay ahead of the market."}
            </p>
            <div className="mt-3 space-y-1 text-sm text-[#C6CDDA]">
              <p>• {isAr ? "تحديثات السوق" : "Market Updates"}</p>
              <p>• {isAr ? "دورات جديدة" : "New Courses"}</p>
              <p>• {isAr ? "إطلاقات المنتج" : "Product Releases"}</p>
              <p>• {isAr ? "أخبار المجتمع" : "Community News"}</p>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                placeholder={isAr ? "البريد الإلكتروني" : "Email Address"}
                className="h-11 w-full rounded-xl border border-white/15 bg-black/40 px-3 text-sm text-white outline-none transition focus:border-[#C9A227]/55 focus:ring-1 focus:ring-[#C9A227]/40"
              />
              <button
                type="button"
                className="group relative inline-flex h-11 items-center justify-center overflow-hidden rounded-xl border border-[#D4AF37]/45 bg-gradient-to-r from-[#B78C1E] via-[#D4AF37] to-[#C79C2A] px-5 text-sm font-semibold text-black shadow-[0_10px_20px_rgba(201,162,39,0.35)] transition hover:-translate-y-0.5"
              >
                <span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-white/35 opacity-0 transition-all duration-700 group-hover:left-[120%] group-hover:opacity-100" />
                {isAr ? "اشترك" : "Subscribe"}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/35 p-5 shadow-[0_10px_24px_rgba(0,0,0,0.28)]">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#D4AF37]">
              {isAr ? "نظرة السوق" : "Market Overview"}
            </p>
            <div className="mt-4 space-y-2 text-sm text-[#D8DFEA]">
              <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                <span>BTC</span>
                <span className="font-semibold text-white">$118,000</span>
                <span className="text-emerald-300">+2.3%</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                <span>ETH</span>
                <span className="font-semibold text-white">$4,580</span>
                <span className="text-emerald-300">+1.2%</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                <span>USDT / ILS</span>
                <span className="font-semibold text-white">3.05</span>
                <span className="inline-flex items-center gap-1 text-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  {isAr ? "مباشر" : "LIVE"}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/35 p-5 shadow-[0_10px_24px_rgba(0,0,0,0.28)]">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#D4AF37]">
              {isAr ? "انضم إلى Alpha Traders" : "Join Alpha Traders"}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                ...(whatsappUrl
                  ? [{ href: whatsappUrl, label: "WhatsApp", icon: MessageCircle }]
                  : []),
                { href: SOCIAL.instagram, label: "Instagram", icon: ExternalLink },
                { href: SOCIAL.tiktok, label: "TikTok", icon: Music2 },
                { href: SOCIAL.discord, label: "Discord", icon: ExternalLink },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <a
                    key={item.label}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-[#D6DCE8] transition hover:border-[#D4AF37]/55 hover:bg-[#D4AF37]/10"
                  >
                    <span>{item.label}</span>
                    <Icon className="h-3.5 w-3.5 text-[#D4AF37] transition-transform duration-200 group-hover:translate-x-0.5" />
                  </a>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3 rounded-2xl border border-[#D4AF37]/25 bg-black/35 px-4 py-3 text-xs text-[#D7DEEA]">
          {TRUST_POINTS.map((item) => (
            <span key={item.en} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#D4AF37]" />
              {isAr ? item.ar : item.en}
            </span>
          ))}
        </div>
      </div>

      <div className="relative border-t border-white/10 bg-black/40">
        <div className="section-container flex flex-col gap-2 py-4 text-xs text-[#B8BFCC] md:flex-row md:items-center md:justify-between">
          <p>© {year} Alpha Traders</p>
          <p>{isAr ? "مبني للمتداولين المحترفين. صُنع بدقة. الإصدار 1.3" : "Built for Professional Traders. Made with precision. Version 1.3"}</p>
          <p className="inline-flex items-center gap-2 text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            {isAr ? "حالة المنصة: تعمل" : "Platform Status: Operational"}
          </p>
        </div>
      </div>
    </footer>
  );
}
