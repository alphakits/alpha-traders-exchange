import { cookiesContent } from "../src/content/legal-content";
import { useLocale } from "../src/i18n/locale-context";
import { LegalScreen } from "../src/screens/legal-screen";

export default function CookiesScreen() {
  const { locale } = useLocale();
  return <LegalScreen content={cookiesContent[locale]} />;
}
