import { privacyContent } from "../src/content/legal-content";
import { useLocale } from "../src/i18n/locale-context";
import { LegalScreen } from "../src/screens/legal-screen";

export default function PrivacyPolicyScreen() {
  const { locale } = useLocale();
  return <LegalScreen content={privacyContent[locale]} />;
}
