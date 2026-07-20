import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { AtSign, MessageCircle, Music2 } from "lucide-react";
import type { AppLocale } from "@/i18n/routing";
import { Link } from "@/i18n/navigation";

const WHATSAPP_URL = "https://wa.me/972525967649";
const INSTAGRAM_URL = "https://www.instagram.com/mark.jozen/";
const TIKTOK_URL = "https://www.tiktok.com/@mark.jozen";

export async function SiteFooter({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale });
  const year = new Date().getFullYear();
  const isAr = locale === "ar";
  return (
    <footer className="mt-16 border-t border-white/10 bg-[#070707] py-10">
      <div className="section-container grid gap-8 md:grid-cols-3">
        <div>
          <div className="inline-flex items-center gap-3">
            <Image
              src="/images/brand/alpha-traders-logo.png"
              alt="Alpha Traders logo"
              width={38}
              height={38}
              style={{ width: 38, height: 38 }}
              className="rounded-full border border-[#C9A227]/45 bg-black/35 p-0.5 object-cover shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
            />
            <h3 className="text-lg font-semibold tracking-wide">{t("brand")}</h3>
          </div>
          <p className="mt-2 text-sm text-[#9CA3AF]">
            {isAr
              ? "تعليم تداول عربي مجاني بمعيار احترافي، مع مسار تعلم منظم وانضباط منهجي."
              : "Free premium Arabic trading education with structured, disciplined learning."}
          </p>
        </div>
        <div className="space-y-2 text-sm text-[#9CA3AF]">
          <Link href="/academy" locale={locale} className="block hover:text-white">
            {t("nav.academy")}
          </Link>
          <Link href="/lessons/trend-and-range-context" locale={locale} className="block hover:text-white">
            {t("nav.lessons")}
          </Link>
          <Link href="/usdt-exchange" locale={locale} className="block hover:text-white">
            {t("nav.alphaExchange")}
          </Link>
        </div>
        <div className="space-y-2 text-sm text-[#9CA3AF]">
          <p>{year} © {t("footer.rights")}</p>
          <p>{isAr ? "مصمم للتعلم الجاد، وليس للضوضاء." : "Built for disciplined learning, not market noise."}</p>
          <div className="pt-2">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-[#25D366] hover:underline"
            >
              <MessageCircle className="h-4 w-4" />
              {isAr ? "واتساب: متاح الآن" : "WhatsApp: Available now"}
            </a>
          </div>
          <div>
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-[#C9A227] hover:underline"
            >
              <AtSign className="h-4 w-4" />
              {isAr ? "إنستغرام: @mark.jozen" : "Instagram: @mark.jozen"}
            </a>
          </div>
          <div>
            <a
              href={TIKTOK_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-[#C9A227] hover:underline"
            >
              <Music2 className="h-4 w-4" />
              {isAr ? "تيك توك: @Mark.Jozen" : "TikTok: @Mark.Jozen"}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
