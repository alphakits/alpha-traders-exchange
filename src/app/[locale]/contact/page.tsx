import { buildPageMetadata } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AtSign, MessageCircle, Music2 } from "lucide-react";

const WHATSAPP_URL = "https://wa.me/972525967649";
const INSTAGRAM_URL = "https://www.instagram.com/mark.jozen/";
const TIKTOK_URL = "https://www.tiktok.com/@mark.jozen";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "تواصل معنا" : "Contact",
    description: locale === "ar" ? "تواصل مع فريق Alpha Traders." : "Contact Alpha Traders team.",
    path: "/contact",
  });
}

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isAr = locale === "ar";

  return (
    <section className="section-container page-shell">
      <h1 className="page-title">{isAr ? "تواصل معنا" : "Contact"}</h1>
      <p className="page-subtitle">
        {isAr ? "راسل فريق Alpha Traders للاستفسارات والشراكات التعليمية." : "Reach the Alpha Traders team for inquiries and educational partnerships."}
      </p>
      <div className={`mt-6 flex flex-wrap gap-3 ${isAr ? "md:justify-end" : ""}`}>
        <a
          href={WHATSAPP_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 text-sm font-medium text-black transition hover:-translate-y-0.5 hover:opacity-90"
        >
          <MessageCircle className="h-4 w-4" />
          {isAr ? "تواصل عبر واتساب" : "Contact on WhatsApp"}
        </a>
        <a
          href={INSTAGRAM_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/20 bg-transparent px-5 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:border-[#C9A227] hover:text-[#C9A227]"
        >
          <AtSign className="h-4 w-4" />
          {isAr ? "تابعنا على إنستغرام" : "Follow on Instagram"}
        </a>
        <a
          href={TIKTOK_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/20 bg-transparent px-5 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:border-[#C9A227] hover:text-[#C9A227]"
        >
          <Music2 className="h-4 w-4" />
          {isAr ? "تيك توك: @Mark.Jozen" : "TikTok: @Mark.Jozen"}
        </a>
      </div>
      <form className="mt-8 grid max-w-3xl gap-4 rounded-2xl border border-white/10 p-5 md:p-6">
        <Input placeholder={isAr ? "الاسم الكامل" : "Full name"} aria-label="name" />
        <Input placeholder={isAr ? "البريد الإلكتروني" : "Email"} type="email" aria-label="email" />
        <Textarea placeholder={isAr ? "رسالتك" : "Your message"} aria-label="message" />
        <Button type="submit">{isAr ? "إرسال" : "Send Message"}</Button>
      </form>
    </section>
  );
}
