import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import mobileAppConfig from "../../apps/mobile/app.json";
import {
  shouldLockForAppState,
  shouldMaskAuthenticatedContent,
} from "../../apps/mobile/src/security/biometric-lock-policy";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("native biometric privacy lock", () => {
  it("masks authenticated content whenever an enabled app leaves the foreground", () => {
    expect(shouldLockForAppState({ enabled: true, authenticated: true, nextState: "inactive" })).toBe(true);
    expect(shouldLockForAppState({ enabled: true, authenticated: true, nextState: "background" })).toBe(true);
    expect(shouldLockForAppState({ enabled: true, authenticated: true, nextState: "active" })).toBe(false);
    expect(shouldLockForAppState({ enabled: false, authenticated: true, nextState: "background" })).toBe(false);
    expect(shouldLockForAppState({ enabled: true, authenticated: false, nextState: "background" })).toBe(false);
    expect(shouldMaskAuthenticatedContent({ authenticated: true, checking: false, locked: true })).toBe(true);
    expect(shouldMaskAuthenticatedContent({ authenticated: true, checking: true, locked: true })).toBe(false);
  });

  it("keeps the biometric sentinel separate from server session credentials", () => {
    const biometricStorage = source("apps/mobile/src/security/biometric-lock-storage.ts");
    const sessionStorage = source("apps/mobile/src/auth/session-storage.ts");

    expect(biometricStorage).toContain("requireAuthentication: true");
    expect(biometricStorage).toContain("CryptoDigestAlgorithm.SHA256");
    expect(biometricStorage).toContain('Platform.OS === "ios"');
    expect(biometricStorage).toContain("clearInvalidatedBiometricLock");
    expect(source("apps/mobile/src/components/biometric-lock-screen.tsx")).toContain("await biometric.reset()");
    expect(sessionStorage).not.toContain("requireAuthentication");
  });

  it("configures Face ID disclosure and hides the underlying navigation tree while locked", () => {
    const secureStorePlugin = mobileAppConfig.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-secure-store");
    const rootLayout = source("apps/mobile/app/_layout.tsx");
    const providers = source("apps/mobile/src/components/app-providers.tsx");

    expect(secureStorePlugin).toEqual([
      "expo-secure-store",
      {
        configureAndroidBackup: true,
        faceIDPermission: "Allow Alpha Traders to use Face ID to unlock and protect your app.",
      },
    ]);
    expect(rootLayout).toContain("accessibilityElementsHidden={maskAuthenticatedContent}");
    expect(rootLayout).toContain('importantForAccessibility={maskAuthenticatedContent ? "no-hide-descendants" : "auto"}');
    expect(rootLayout).toContain("<View accessibilityViewIsModal style={styles.lockOverlay}>");
    expect(rootLayout).toContain("<BiometricLockScreen />");
    expect(providers).toContain('nextState === "active" && !isLocked');
  });
});
