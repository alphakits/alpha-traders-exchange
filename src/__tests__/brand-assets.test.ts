import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BRAND_ROOT = join(process.cwd(), "public", "images", "brand");
const CURRENT_LOGO_SHA256 = "e2d02b50ee93956c92bf7473d355753a3fc36245785a094700b99c8f7811808f";

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
});
