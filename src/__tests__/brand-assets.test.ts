import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BRAND_ROOT = join(process.cwd(), "public", "images", "brand");
const CURRENT_LOGO_SHA256 = "e2d02b50ee93956c92bf7473d355753a3fc36245785a094700b99c8f7811808f";
const APP_ICON_SHA256 = "47346c7eb545dcf0372fffe7825ff6ebe82a701e6e6531f9dbc43b191a89a322";
const MASKABLE_APP_ICON_SHA256 = "3251d430ad99135d7e754891bfd68358da19effceaa0f3dc99d49cb8fd6a0b3c";

describe("current Alpha Traders brand assets", () => {
  it("keeps the approved Academy & Exchange artwork as the canonical PNG", () => {
    const logo = readFileSync(join(BRAND_ROOT, "alpha-traders-logo.png"));
    expect(createHash("sha256").update(logo).digest("hex")).toBe(CURRENT_LOGO_SHA256);
  });

  it("ships every PWA icon referenced by the manifest", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "public", "manifest.json"), "utf8")) as {
      name: string;
      short_name: string;
      lang: string;
      dir: string;
      shortcuts: Array<{ url: string }>;
      icons: Array<{ src: string }>;
    };

    expect(manifest.name).toBe("Alpha Traders Academy & Exchange");
    expect(manifest.short_name).toBe("Alpha Traders");
    expect(manifest.lang).toBe("mul");
    expect(manifest.dir).toBe("auto");
    expect(manifest.shortcuts.map((shortcut) => shortcut.url)).toEqual(["/usdt-exchange", "/academy"]);
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      "/images/brand/alpha-traders-logo-192.png",
      "/images/brand/alpha-traders-logo-512.png",
      "/images/brand/alpha-traders-logo-maskable-512.png",
    ]);
    for (const icon of manifest.icons) {
      expect(existsSync(join(process.cwd(), "public", icon.src))).toBe(true);
    }
  });

  it("keeps the supplied high-resolution artwork as the native app icon", () => {
    const appIcon = readFileSync(join(BRAND_ROOT, "alpha-traders-app-icon-1024.png"));
    const maskableIcon = readFileSync(join(BRAND_ROOT, "alpha-traders-app-icon-maskable-1024.png"));
    expect(createHash("sha256").update(appIcon).digest("hex")).toBe(APP_ICON_SHA256);
    expect(createHash("sha256").update(maskableIcon).digest("hex")).toBe(MASKABLE_APP_ICON_SHA256);
  });
});
