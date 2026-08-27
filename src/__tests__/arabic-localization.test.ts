import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatAcademyLevel, formatLessonDifficulty } from "@/lib/academy-localization";
import { localizeNotificationActionLabel, localizeNotificationCopy } from "@/lib/notification-localization";
import type { AlphaExchangeNotification } from "@/types/alpha-exchange";

const ARABIC_PATTERN = /[\u0600-\u06ff]/;
const MOJIBAKE_PATTERN = /Ø|Ù|�|Ã|Â|â€¦|â€™/;
const TECHNICAL_ARABIC_FIELD = /^(?:Alpha Traders|USDT|TRC20|ERC20|BEP20|SOL|RSI|ICT|PDF|PPTX)$/i;

function collectArabicFields(value: unknown, path = "$", result: Array<{ path: string; value: string }> = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectArabicFields(item, `${path}[${index}]`, result));
    return result;
  }
  if (!value || typeof value !== "object") return result;
  for (const [key, item] of Object.entries(value)) {
    if (key.endsWith("Ar")) {
      const values = Array.isArray(item) ? item : [item];
      values.forEach((entry, index) => {
        if (typeof entry === "string" && entry.trim()) {
          result.push({ path: `${path}.${key}${Array.isArray(item) ? `[${index}]` : ""}`, value: entry });
        }
      });
    }
    collectArabicFields(item, `${path}.${key}`, result);
  }
  return result;
}

describe("Arabic localization integrity", () => {
  it("keeps every Academy Arabic field valid UTF-8 Arabic text", () => {
    for (const filename of ["lessons-provided.json", "courses-provided.json", "lessons.json", "courses.json"]) {
      const raw = readFileSync(join(process.cwd(), "src", "data", filename), "utf8").replace(/^\uFEFF/, "");
      expect(raw, filename).not.toMatch(MOJIBAKE_PATTERN);
      const fields = collectArabicFields(JSON.parse(raw));
      expect(fields.length, filename).toBeGreaterThan(0);
      for (const field of fields) {
        expect(
          ARABIC_PATTERN.test(field.value) || TECHNICAL_ARABIC_FIELD.test(field.value.trim()),
          `${filename}:${field.path} must contain Arabic or an approved technical term`,
        ).toBe(true);
      }
    }
  });

  it("localizes every Academy level and difficulty used by course data", () => {
    expect(formatAcademyLevel("beginner", "ar")).toBe("مبتدئ");
    expect(formatAcademyLevel("ict", "ar")).toBe("مفاهيم ICT");
    expect(formatAcademyLevel("risk-management", "ar")).toBe("إدارة المخاطر");
    expect(formatLessonDifficulty("easy", "ar")).toBe("سهل");
    expect(formatLessonDifficulty("expert", "ar")).toBe("خبير");
  });

  it("never exposes an English-only notification title, message, or action in Arabic", () => {
    const notification = {
      title: "New trade room message",
      message: "The seller sent a new message in your trade room.",
      category: "trade",
    } as AlphaExchangeNotification;

    const copy = localizeNotificationCopy(notification, "ar");
    expect(copy.title).toMatch(ARABIC_PATTERN);
    expect(copy.message).toMatch(ARABIC_PATTERN);
    expect(localizeNotificationActionLabel("Continue Trade", "ar", notification)).toMatch(ARABIC_PATTERN);
  });

  it("keeps the mobile brand lockup visible without ellipsis truncation", () => {
    const header = readFileSync(join(process.cwd(), "src", "components", "layout", "site-header.tsx"), "utf8");
    expect(header).toContain("BRAND_PRIMARY_NAME");
    expect(header).toContain("BRAND_DESCRIPTOR");
    expect(header).toContain("whitespace-nowrap");
    expect(header).not.toContain("gold-gradient truncate");
  });
});
