// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("mobile website parity", () => {
  it("uses the production website as the only rendered product surface", () => {
    const root = source("apps/mobile/app/_layout.tsx");
    const shell = source("apps/mobile/src/components/website-app-shell.tsx");
    const websiteBridge = source("src/components/mobile/native-app-bridge.tsx");
    const navigation = source("apps/mobile/src/web/website-navigation.ts");
    const nativeNotifications = source("apps/mobile/src/notifications/native-notifications.ts");
    const mobilePackage = source("apps/mobile/package.json");
    const mobileConfig = source("apps/mobile/app.json");
    const installedIphoneWorkflow = source("apps/mobile/.eas/workflows/iphone-installed-preview.yml");

    expect(root).toContain("<WebsiteAppShell");
    expect(root).toContain("screenLayout={() => <WebsiteScreen />}");
    expect(root).toContain("<NetworkProvider>");
    expect(root).not.toContain("{children}");
    expect(shell).toContain('from "react-native-webview"');
    expect(shell).toContain("source={source}");
    expect(shell).toContain("sharedCookiesEnabled");
    expect(shell).toContain("cacheEnabled");
    expect(shell).toContain("allowsBackForwardNavigationGestures");
    expect(shell).toContain('if (!request.isTopFrame) return decision === "allow"');
    expect(shell).not.toContain("injectedJavaScript=");
    expect(shell).toContain("onMessage={handleWebsiteMessage}");
    expect(shell).toContain("addNotificationResponseReceivedListener");
    expect(shell).toContain("addPushTokenListener");
    expect(shell).toContain("setBadgeCountAsync(message.unreadCount)");
    expect(shell).toContain("pendingPushRegistrationRef.current = {");
    expect(shell).toContain("forceRefresh: forceRefresh || Boolean(");
    expect(shell).toContain("ensurePushRegistration(session.userId, session.locale, true)");
    expect(shell).toContain("Linking.openSettings()");
    expect(shell).toContain('accessibilityRole="alert"');
    expect(shell).toContain('message.type === "alpha.web.push-registration"');
    expect(shell).toContain("isTrustedWebsiteDocumentUrl(event.nativeEvent.url)");
    expect(shell).toContain('mixedContentMode="never"');
    expect(shell).toContain("thirdPartyCookiesEnabled={false}");
    expect(shell).toContain("allowFileAccess={false}");
    expect(shell).toContain('readiness.status === "update_required"');
    expect(shell).toContain("useMobileAppReadiness(locale, isOnline)");
    expect(shell).toContain('accessibilityLiveRegion="polite"');
    expect(websiteBridge).toContain('status: "registered"');
    expect(websiteBridge).toContain('status: "failed"');
    expect(shell).toContain('AppState.currentState !== "active"');
    expect(shell).toContain("pendingReviewRef.current = tradeReference");
    expect(shell).toContain("if (!hasLoadedContentRef.current) setIsLoading(true)");
    expect(shell).toContain("if (loadErrorRef.current ||");
    expect(shell).toContain('if (decision === "allow")');
    expect(shell).toContain("setSource({ uri: targetUrl })");
    expect(nativeNotifications).toContain("ExecutionEnvironment.StoreClient");
    expect(navigation).toContain('https://www.alphatraders.co.il');
    expect(mobilePackage).toContain('"react-native-webview": "13.16.1"');
    expect(mobilePackage).toContain('"expo-notifications": "~57.0.17"');
    expect(mobilePackage).toContain('"expo-store-review": "~57.0.2"');
    expect(mobileConfig).toContain('"icon": "../../public/images/brand/alpha-traders-app-icon-1024.png"');
    expect(mobileConfig).toContain('"foregroundImage": "../../public/images/brand/alpha-traders-app-icon-maskable-1024.png"');
    expect(mobileConfig).toContain('"expo-notifications"');
    expect(mobileConfig).toContain('"cameraPermission": "Allow Alpha Traders');
    expect(mobileConfig).toContain('"microphonePermission": false');
    expect(mobileConfig).toContain('"NSAllowsArbitraryLoads": false');
    expect(installedIphoneWorkflow).toContain("type: apple-device-registration-request");
    expect(installedIphoneWorkflow).toContain("profile: preview");
    expect(installedIphoneWorkflow).toContain("refresh_ad_hoc_provisioning_profile: true");
  });
});
