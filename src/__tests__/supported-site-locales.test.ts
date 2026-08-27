import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";

describe("supported site languages", () => {
  it("offers exactly Arabic and English", () => {
    expect([...routing.locales]).toEqual(["ar", "en"]);
  });

  it("does not advertise an unavailable third interface language", () => {
    const source = readFileSync(join(process.cwd(), "src/components/sections/home/homepage-stats.tsx"), "utf8");
    expect(source).toContain('subtitleEn: "English • Arabic"');
    expect(source).toContain('subtitleAr: "الإنجليزية • العربية"');
    expect(source).not.toMatch(/עברית|العبرية/);
  });
});
