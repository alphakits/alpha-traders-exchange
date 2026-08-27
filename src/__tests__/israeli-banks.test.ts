import { describe, expect, it } from "vitest";
import { getIsraeliBankDisplayName, getIsraeliBankOption, normalizeIsraeliBankName } from "@/lib/israeli-banks";

describe("israeli bank helpers", () => {
  it("resolves the official bank option from a known bank name", () => {
    expect(getIsraeliBankOption("Bank Leumi")).toMatchObject({ name: "Bank Leumi", code: "leumi" });
  });

  it("normalizes a user-friendly bank name to its canonical label", () => {
    expect(normalizeIsraeliBankName("bank hapoalim")).toBe("Bank Hapoalim");
  });

  it("supports the full Israeli bank roster required by the experience", () => {
    const options = ["Bank Leumi", "Bank Hapoalim", "Mizrahi-Tefahot", "Discount", "First International", "Yahav", "Mercantile", "Massad", "Jerusalem", "ONE ZERO"];
    for (const optionName of options) {
      expect(getIsraeliBankOption(optionName).name).toBe(optionName);
    }
  });

  it("normalizes the full roster aliases used in the UI", () => {
    expect(normalizeIsraeliBankName("mizrahi-tefahot bank")).toBe("Mizrahi-Tefahot");
    expect(normalizeIsraeliBankName("one-zero")).toBe("ONE ZERO");
  });

  it("falls back to the generic bank transfer label for unknown banks", () => {
    expect(getIsraeliBankOption("Mystery Bank")).toMatchObject({ name: "Bank transfer" });
  });

  it("shows Arabic bank names without changing the canonical stored value", () => {
    expect(getIsraeliBankDisplayName("Bank Hapoalim", "ar")).toBe("بنك هبوعليم");
    expect(getIsraeliBankDisplayName("Bank Hapoalim", "en")).toBe("Bank Hapoalim");
    expect(normalizeIsraeliBankName("Bank Hapoalim")).toBe("Bank Hapoalim");
  });

  it("preserves unknown legacy bank labels only when they match the display language", () => {
    expect(getIsraeliBankDisplayName("Legacy Community Bank", "en")).toBe("Legacy Community Bank");
    expect(getIsraeliBankDisplayName("Legacy Community Bank", "ar")).toBe("تحويل بنكي");
    expect(getIsraeliBankDisplayName("بنك محلي", "ar")).toBe("بنك محلي");
  });
});
