import { describe, expect, it } from "vitest";
import { normalizePreferredLocale } from "@/lib/preferred-locale";

describe("normalizePreferredLocale", () => {
  it("preserves only supported explicit interface locales", () => {
    expect(normalizePreferredLocale("ar")).toBe("ar");
    expect(normalizePreferredLocale("en")).toBe("en");
  });

  it("defaults missing and invalid preferences to English", () => {
    expect(normalizePreferredLocale(undefined)).toBe("en");
    expect(normalizePreferredLocale("he")).toBe("en");
  });
});
