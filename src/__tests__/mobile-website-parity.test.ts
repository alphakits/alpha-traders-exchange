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
    const navigation = source("apps/mobile/src/web/website-navigation.ts");
    const mobilePackage = source("apps/mobile/package.json");

    expect(root).toContain("<WebsiteAppShell");
    expect(root).toContain("screenLayout={() => <WebsiteScreen />}");
    expect(root).not.toContain("{children}");
    expect(shell).toContain('from "react-native-webview"');
    expect(shell).toContain("source={source}");
    expect(shell).toContain("sharedCookiesEnabled");
    expect(shell).toContain("cacheEnabled");
    expect(shell).toContain("allowsBackForwardNavigationGestures");
    expect(shell).toContain('if (!request.isTopFrame) return decision !== "block"');
    expect(shell).not.toContain("injectedJavaScript=");
    expect(navigation).toContain('https://www.alphatraders.co.il');
    expect(mobilePackage).toContain('"react-native-webview": "13.16.1"');
  });
});
