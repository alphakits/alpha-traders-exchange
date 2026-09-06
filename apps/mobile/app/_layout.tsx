import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { colors } from "@alpha-traders/design-tokens";
import { AppProviders } from "../src/components/app-providers";
import { useAuth } from "../src/auth/auth-context";
import { BootScreen } from "../src/components/boot-screen";
import { SessionRecoveryScreen } from "../src/components/session-recovery-screen";
import { useLocale } from "../src/i18n/locale-context";

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { status } = useAuth();
  const { isHydrated, isRTL } = useLocale();

  useEffect(() => {
    if (isHydrated && status !== "booting") void SplashScreen.hideAsync();
  }, [isHydrated, status]);

  if (!isHydrated || status === "booting") return <BootScreen />;
  if (status === "unavailable") return <SessionRecoveryScreen />;

  return (
    <View style={[styles.root, { direction: isRTL ? "rtl" : "ltr" }]}>
      <StatusBar style="light" />
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
