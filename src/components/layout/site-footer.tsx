import type { AppLocale } from "@/i18n/routing";
import { getOfficialOwnerWhatsAppUrl } from "@/lib/official-contact";
import { SiteFooterContent } from "@/components/layout/site-footer-content";

export async function SiteFooter({ locale }: { locale: AppLocale }) {
  return <SiteFooterContent locale={locale} whatsappUrl={getOfficialOwnerWhatsAppUrl()} />;
}
