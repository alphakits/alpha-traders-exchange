import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { colors } from "@alpha-traders/design-tokens";
import { useReducedMotion } from "../src/accessibility/use-reduced-motion";
import { AppProviders } from "../src/components/app-providers";
import { useAuth } from "../src/auth/auth-context";
import { BootScreen } from "../src/components/boot-screen";
import { NetworkStatusBanner } from "../src/components/network-status-banner";
import { SessionRecoveryScreen } from "../src/components/session-recovery-screen";
import { UpdateRequiredScreen } from "../src/components/update-required-screen";
import { BiometricLockScreen } from "../src/components/biometric-lock-screen";
import { useLocale } from "../src/i18n/locale-context";
import { useNetworkStatus } from "../src/network/network-context";
import { useMobileAppReadiness } from "../src/readiness/use-mobile-app-readiness";
import { useBiometricLock } from "../src/security/biometric-lock-context";
import { shouldMaskAuthenticatedContent } from "../src/security/biometric-lock-policy";

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { status } = useAuth();
  const { locale, isHydrated, isRTL } = useLocale();
  const { isOnline } = useNetworkStatus();
  const biometric = useBiometricLock();
  const isReducedMotionEnabled = useReducedMotion();
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
  if (status === "authenticated" && biometric.isChecking) return <BootScreen />;

  const maskAuthenticatedContent = shouldMaskAuthenticatedContent({
    authenticated: status === "authenticated",
    checking: biometric.isChecking,
    locked: biometric.isLocked,
  });

  return (
    <View style={[styles.root, { direction: isRTL ? "rtl" : "ltr" }]}>
      <StatusBar style="light" />
      <View
        accessibilityElementsHidden={maskAuthenticatedContent}
        importantForAccessibility={maskAuthenticatedContent ? "no-hide-descendants" : "auto"}
        pointerEvents={maskAuthenticatedContent ? "none" : "auto"}
        style={styles.navigator}
      >
        <NetworkStatusBanner />
        <Stack
          screenOptions={{
            animation: isReducedMotionEnabled ? "none" : "fade",
            contentStyle: { backgroundColor: colors.background },
            headerShown: false,
          }}
        />
      </View>
      {maskAuthenticatedContent ? (
        <View accessibilityViewIsModal style={styles.lockOverlay}>
          <BiometricLockScreen />
        </View>
      ) : null}
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
  navigator: {
    flex: 1,
  },
  lockOverlay: {
    backgroundColor: colors.background,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 100,
  },
});
