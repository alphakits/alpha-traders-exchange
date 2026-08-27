import { describe, expect, it } from "vitest";
import { normalizePreferredLocale } from "@/lib/preferred-locale";

describe("normalizePreferredLocale", () => {
  it("preserves only supported explicit interface locales", () => {
    expect(normalizePreferredLocale("ar")).toBe("ar");
    expect(normalizePreferredLocale("en")).toBe("en");
  });

  it("defaults legacy and invalid records to the Arabic site locale", () => {
    expect(normalizePreferredLocale(undefined)).toBe("ar");
    expect(normalizePreferredLocale("he")).toBe("ar");
  });
});
