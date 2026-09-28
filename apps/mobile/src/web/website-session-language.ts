import type { MobileLocale } from "@alpha-traders/contracts";
import { trustedWebsiteResumeUrl } from "./website-navigation";

// Written only by the trusted web session bridge, never by device language or
// ordinary navigation. Logout clears the Arabic choice for the next session.
export const WEBSITE_SESSION_LOCALE_KEY = "alpha.mobile.website.session-locale.v1";
export const DEFAULT_MOBILE_LOCALE: MobileLocale = "en";

export function websiteSessionResume(storedLocale: string | null, storedResumeUrl: string | null) {
  const locale: MobileLocale = storedLocale === "ar" ? "ar" : DEFAULT_MOBILE_LOCALE;
  const url = new URL(trustedWebsiteResumeUrl(storedResumeUrl, locale));
  url.pathname = url.pathname.replace(/^\/(?:ar|en)(?=\/|$)/, `/${locale}`);
  return { locale, uri: url.toString() };
}
