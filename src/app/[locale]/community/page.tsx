import { getLocale } from "next-intl/server";
import Image from "next/image";
import { ArrowUpRight, MessageCircle, Music2, Users } from "lucide-react";
import { buildPageMetadata } from "@/lib/seo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const WHATSAPP_COMMUNITY_URL = "https://chat.whatsapp.com/DoxDO1RHVkm87l1yj8YO4d?s=cl&p=i&ilr=4";
const TIKTOK_PROFILE_URL = "https://www.tiktok.com/@mark_jozen";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "المجتمع" : "Community",
    description: locale === "ar" ? "مجتمع Alpha Traders للتعلم والنقاش المنظم." : "Structured learning community for Alpha Traders.",
    path: "/community",
  });
}

export default async function CommunityPage() {
  const locale = await getLocale();
  const isAr = locale === "ar";
  const items = isAr
    ? ["جلسات مراجعة أسبوعية", "نقاشات تحليلية منهجية", "مجموعات متابعة التعلم"]
    : ["Weekly review sessions", "Structured analysis discussions", "Learning accountability groups"];
  const stats = isAr
    ? ["+900 عضو في المجتمع", "نقاشات يومية نشطة", "نقاشات تبادل USDT", "مجتمع تداول متنامٍ"]
    : ["900+ Community Members", "Active Daily Discussions", "USDT Exchange Discussions", "Growing Trading Community"];

  return (
    <section className="section-container page-shell">
      <h1 className="page-title">{isAr ? "المجتمع" : "Community"}</h1>
      <p className="page-subtitle">
        {isAr ? "مساحة تعليمية منظمة للتطبيق، المتابعة، والنقاش المهني." : "A structured space for practice, accountability, and professional discussion."}
      </p>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {items.map((item) => (
          <Card key={item} className="h-full hover:-translate-y-0.5">
            <CardHeader>
              <CardTitle className="text-lg">{item}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-[#9CA3AF]">
              {isAr ? "بيئة تعلم احترافية خالية من الضوضاء." : "Premium noise-free educational environment."}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="surface-panel mt-10 p-5 md:p-8">
        <div className="grid gap-8 lg:grid-cols-[1.05fr_1fr]">
          <div className={`${isAr ? "lg:text-right" : "lg:text-left"}`}>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#25D366]/35 bg-[#25D366]/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-[#25D366]">
              <MessageCircle className="h-3.5 w-3.5" />
              WhatsApp
            </p>
            <h2 className="text-2xl font-semibold leading-tight md:text-3xl">
              {isAr ? "انضم إلى مجتمع Alpha Traders" : "Join the Alpha Traders Community"}
            </h2>
            <p className="mt-4 text-sm leading-7 text-[#9CA3AF] md:text-base">
              {isAr
                ? "مجتمع الواتساب العام يضم +900 عضو نشط يتداولون، يناقشون فرص السوق، ويتبادلون خبرات ونقاشات USDT بشكل يومي."
                : "Our public WhatsApp community is home to 900+ active members who trade, exchange USDT discussions, share market insights, discuss opportunities, and support each other daily."}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {(isAr
                ? ["شراء وبيع USDT", "نقاشات تبادل العملات", "متداولون نشطون", "تحديثات السوق", "دعم المجتمع", "حوارات تداول"]
                : ["USDT buyers & sellers", "Crypto exchange discussions", "Active traders", "Market updates", "Community support", "Trading conversations"]
              ).map((item) => (
                <span key={item} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-[#D1D5DB]">
                  {item}
                </span>
              ))}
            </div>

            <a
              href={WHATSAPP_COMMUNITY_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-7 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#25D366] px-6 text-sm font-medium text-black transition hover:-translate-y-0.5 hover:opacity-90"
            >
              {isAr ? "انضم إلى مجتمع الواتساب" : "Join the WhatsApp Community"}
              <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { src: "/images/hero/hero-trading-office.webp", altAr: "بيئة تداول احترافية", alt: "Professional trading environment" },
              { src: "/images/course-materials/webp/image32.webp", altAr: "نقاشات النماذج السعرية", alt: "Pattern discussion visual" },
              { src: "/images/course-materials/webp/image48.webp", altAr: "تحليل مستويات السوق", alt: "Market level analysis visual" },
              { src: "/images/course-materials/webp/image53.webp", altAr: "تأكيد الترندلاين", alt: "Trendline confirmation visual" },
            ].map((item) => (
              <div key={item.src} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                <div className="relative aspect-[4/3]">
                  <Image
                    src={item.src}
                    alt={isAr ? item.altAr : item.alt}
                    fill
                    sizes="(max-width: 768px) 100vw, 40vw"
                    quality={75}
                    className="object-cover transition duration-500 group-hover:scale-[1.04]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/20 to-transparent" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-7 grid gap-3 md:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat} className="rounded-2xl border border-white/10 bg-black/20 p-4 text-center text-sm font-medium text-[#E5E7EB]">
              {stat}
            </div>
          ))}
        </div>

        <div className={`mt-6 rounded-2xl border border-[#C9A227]/20 bg-[#C9A227]/[0.06] p-4 text-sm leading-7 text-[#D1D5DB] ${isAr ? "md:text-right" : ""}`}>
          <div className={`inline-flex items-center gap-2 font-medium text-[#E5E7EB] ${isAr ? "flex-row-reverse" : ""}`}>
            <Users className="h-4 w-4 text-[#C9A227]" />
            {isAr ? "بيان ثقة المجتمع" : "Community Trust Note"}
          </div>
          <p className="mt-2">
            {isAr
              ? "تم إنشاء المجتمع للأشخاص الراغبين بالتواصل مع متداولين آخرين والمشاركة في نقاشات تبادل USDT وحوارات السوق. المشاركة تهدف لتبادل الخبرة والمعلومات التعليمية فقط، بدون أي وعود بالأرباح أو ضمانات للمعاملات."
              : "This community is intended for people who want to connect with other traders and participate in USDT exchange discussions. It is built for educational sharing and peer conversations, without guarantees of profits, transactions, or outcomes."}
          </p>
        </div>
      </div>

      <div className="surface-panel mt-8 p-5 md:p-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.05fr]">
          <div className={`${isAr ? "lg:text-right" : "lg:text-left"}`}>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[0.03] px-3 py-1 text-xs uppercase tracking-[0.2em] text-white">
              <Music2 className="h-3.5 w-3.5 text-[#C9A227]" />
              TikTok
            </p>
            <h2 className="text-2xl font-semibold leading-tight md:text-3xl">
              {isAr ? "تابع رحلتنا على تيك توك" : "Follow Our Journey on TikTok"}
            </h2>
            <p className="mt-4 text-sm leading-7 text-[#9CA3AF] md:text-base">
              {isAr
                ? "تابع @Mark_Jozen للحصول على محتوى تداول، رؤى السوق، فيديوهات تعليمية، تحديثات المجتمع، ولمحات من كواليس Alpha Traders."
                : "Follow @Mark_Jozen for trading content, market insights, educational videos, community updates, and behind-the-scenes content from Alpha Traders."}
            </p>

            <div className={`surface-panel-subtle mt-6 p-5 ${isAr ? "md:text-right" : ""}`}>
              <div className={`flex items-center justify-between gap-4 ${isAr ? "flex-row-reverse" : ""}`}>
                <div className={`inline-flex items-center gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/[0.04]">
                    <Music2 className="h-5 w-5 text-[#C9A227]" />
                  </span>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-[#9CA3AF]">Official Creator</p>
                    <p className="text-base font-medium text-white">@Mark_Jozen</p>
                  </div>
                </div>
                <a
                  href={TIKTOK_PROFILE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-white/20 bg-transparent px-4 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:border-[#C9A227] hover:text-[#C9A227]"
                >
                  {isAr ? "تابع على تيك توك" : "Follow on TikTok"}
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-[#0F0F0F] p-3">
                <p className="text-xs text-[#9CA3AF]">{isAr ? "معاينة الملف الشخصي" : "Profile preview"}</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {["/images/community/tiktok-preview-1.png", "/images/community/tiktok-preview-2.png", "/images/community/tiktok-preview-3.png"].map((src, index) => (
                    <div key={src} className="relative aspect-[9/16] overflow-hidden rounded-lg border border-white/10 bg-black/40">
                      <Image
                        src={src}
                        alt=""
                        aria-hidden={true}
                        fill
                        sizes="(max-width: 768px) 30vw, 220px"
                        quality={75}
                        className="object-cover blur-[1.6px] brightness-75 scale-110"
                      />
                      <Image
                        src={src}
                        alt={isAr ? `معاينة فيديو Alpha Traders على TikTok ${index + 1}` : `Alpha Traders TikTok video preview ${index + 1}`}
                        fill
                        sizes="(max-width: 768px) 30vw, 220px"
                        quality={75}
                        className="object-contain p-1.5"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { src: "/images/hero/hero-trading-office.webp", altAr: "بيئة تداول احترافية", alt: "Professional trading workspace" },
              { src: "/images/course-materials/webp/image50.webp", altAr: "محتوى USDT", alt: "USDT themed market visual" },
              { src: "/images/course-materials/webp/image32.webp", altAr: "تفاعل المجتمع", alt: "Community interaction visual" },
              { src: "/images/course-materials/webp/image48.webp", altAr: "لوحة تحليل السوق", alt: "Trading dashboard visual" },
            ].map((item) => (
              <div key={item.src} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                <div className="relative aspect-[4/3]">
                  <Image
                    src={item.src}
                    alt={isAr ? item.altAr : item.alt}
                    fill
                    sizes="(max-width: 768px) 100vw, 40vw"
                    quality={75}
                    className="object-cover transition duration-500 group-hover:scale-[1.04]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/20 to-transparent" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
