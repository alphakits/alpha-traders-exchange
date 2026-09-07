import { termsContent } from "../src/content/legal-content";
import { useLocale } from "../src/i18n/locale-context";
import { LegalScreen } from "../src/screens/legal-screen";

export default function TermsScreen() {
  const { locale } = useLocale();
  return <LegalScreen content={termsContent[locale]} />;
}
