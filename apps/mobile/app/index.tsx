import { Redirect } from "expo-router";
import { BootScreen } from "../src/components/boot-screen";
import { SessionRecoveryScreen } from "../src/components/session-recovery-screen";
import { useAuth } from "../src/auth/auth-context";
import { useLocale } from "../src/i18n/locale-context";

export default function Index() {
  const { status, user } = useAuth();
  const { isHydrated, hasSelectedLocale } = useLocale();
  if (!isHydrated || status === "booting") return <BootScreen />;
  if (status === "unavailable") return <SessionRecoveryScreen />;
  if (!hasSelectedLocale) return <Redirect href="/(public)/welcome" />;
  if (
    status === "authenticated"
    && user
    && !user.onboardingSelection
    && !user.onboardingCompletedAt
    && user.roles.length === 1
    && user.roles[0] === "guest"
  ) {
    return <Redirect href="/onboarding" />;
  }
  if (status === "authenticated" && user?.roles.some((role) => role === "owner" || role === "admin")) {
    return <Redirect href="/admin" />;
  }
  if (status === "authenticated") return <Redirect href="/(tabs)" />;
  return <Redirect href="/(public)/welcome" />;
}
