import { Redirect } from "expo-router";
import { BootScreen } from "../src/components/boot-screen";
import { SessionRecoveryScreen } from "../src/components/session-recovery-screen";
import { useAuth } from "../src/auth/auth-context";
import { useLocale } from "../src/i18n/locale-context";

export default function Index() {
  const { status } = useAuth();
  const { isHydrated, hasSelectedLocale } = useLocale();
  if (!isHydrated || status === "booting") return <BootScreen />;
  if (status === "unavailable") return <SessionRecoveryScreen />;
  if (!hasSelectedLocale) return <Redirect href="/(public)/welcome" />;
  if (status === "authenticated") return <Redirect href="/(tabs)" />;
  return <Redirect href="/(public)/welcome" />;
}
