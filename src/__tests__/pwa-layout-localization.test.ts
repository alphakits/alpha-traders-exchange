import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("PWA chrome localization", () => {
  it("renders locale-sensitive PWA chrome from the locale layout", () => {
    const rootLayout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    const localeLayout = readFileSync(join(process.cwd(), "src/app/[locale]/layout.tsx"), "utf8");

    expect(rootLayout).not.toMatch(/OfflineBanner|PwaInstallPrompt/);
    expect(localeLayout).toContain("<OfflineBanner locale={appLocale} />");
    expect(localeLayout).toContain("<PwaInstallPrompt locale={appLocale} />");
  });
});
