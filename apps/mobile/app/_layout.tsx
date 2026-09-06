import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { colors } from "@alpha-traders/design-tokens";
import { AppProviders } from "../src/components/app-providers";
import { useAuth } from "../src/auth/auth-context";
import { BootScreen } from "../src/components/boot-screen";
import { NetworkStatusBanner } from "../src/components/network-status-banner";
import { SessionRecoveryScreen } from "../src/components/session-recovery-screen";
import { UpdateRequiredScreen } from "../src/components/update-required-screen";
import { useLocale } from "../src/i18n/locale-context";
import { useNetworkStatus } from "../src/network/network-context";
import { useMobileAppReadiness } from "../src/readiness/use-mobile-app-readiness";

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { status } = useAuth();
  const { locale, isHydrated, isRTL } = useLocale();
  const { isOnline } = useNetworkStatus();
  const readiness = useMobileAppReadiness(locale, isOnline);

  useEffect(() => {
    if (isHydrated && status !== "booting" && readiness.status !== "checking") {
      void SplashScreen.hideAsync();
    }
  }, [isHydrated, readiness.status, status]);

  if (!isHydrated || status === "booting" || readiness.status === "checking") {
    return <BootScreen />;
  }
  if (readiness.status === "update_required") {
    return <UpdateRequiredScreen config={readiness.config} />;
  }
  if (status === "unavailable") return <SessionRecoveryScreen />;

  return (
    <View style={[styles.root, { direction: isRTL ? "rtl" : "ltr" }]}>
      <StatusBar style="light" />
      <NetworkStatusBanner />
      <Stack
        screenOptions={{
          animation: "fade",
          contentStyle: { backgroundColor: colors.background },
          headerShown: false,
        }}
      />
    </View>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
});
