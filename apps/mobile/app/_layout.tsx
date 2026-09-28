import { useCallback } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { WebsiteAppShell } from "../src/components/website-app-shell";
import { NetworkProvider } from "../src/network/network-context";

void SplashScreen.preventAutoHideAsync();

function WebsiteScreen() {
  const hideSplash = useCallback(() => {
    void SplashScreen.hideAsync();
  }, []);

  return <WebsiteAppShell onNativeReady={hideSplash} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <NetworkProvider>
        <Stack
          screenLayout={() => <WebsiteScreen />}
          screenOptions={{
            animation: "none",
            contentStyle: { backgroundColor: "#050505" },
            headerShown: false,
          }}
        />
      </NetworkProvider>
    </SafeAreaProvider>
  );
}
