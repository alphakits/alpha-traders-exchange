import { getLocale } from "next-intl/server";
import { NotFoundContent } from "@/components/errors/not-found-content";

export default async function LocalizedNotFound() {
  const locale = await getLocale();
  return <NotFoundContent locale={locale as "ar" | "en"} />;
}
