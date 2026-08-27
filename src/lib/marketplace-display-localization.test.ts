import { describe, expect, it } from "vitest";

import {
  marketplacePaymentMethodLabelForLocale,
  marketplacePaymentMethodLabelsForLocale,
  spokenLanguageLabelForLocale,
  trustFlagReasonLabelForLocale,
} from "@/lib/marketplace-display-localization";

describe("marketplace display localization", () => {
  it("localizes every canonical payment method and legacy aliases", () => {
    expect(marketplacePaymentMethodLabelForLocale("Bank Transfer", "ar")).toBe("تحويل بنكي");
    expect(marketplacePaymentMethodLabelForLocale("meet in person", "ar")).toBe("لقاء مباشر وجهًا لوجه");
    expect(marketplacePaymentMethodLabelForLocale("سحب من الصراف بلا بطاقة", "en")).toBe("Cardless ATM Withdrawal");
  });

  it("formats all listing payment methods instead of leaking only the legacy fallback", () => {
    expect(marketplacePaymentMethodLabelsForLocale(
      ["Bank Transfer", "Cardless ATM Withdrawal"],
      "Face-to-Face (Meet in Person)",
      "ar",
    )).toEqual(["تحويل بنكي", "سحب من الصراف دون بطاقة", "لقاء مباشر وجهًا لوجه"]);
  });

  it("uses a safe Arabic payment fallback while preserving same-language legacy text", () => {
    expect(marketplacePaymentMethodLabelForLocale("Unrecognized legacy rail", "ar")).toBe("طريقة دفع أخرى");
    expect(marketplacePaymentMethodLabelForLocale("طريقة محلية", "ar")).toBe("طريقة محلية");
  });

  it("localizes stored language names and safely handles unknown values", () => {
    expect(spokenLanguageLabelForLocale("English", "ar")).toBe("الإنجليزية");
    expect(spokenLanguageLabelForLocale("עברית", "ar")).toBe("العبرية");
    expect(spokenLanguageLabelForLocale("Unknown Latin value", "ar")).toBe("لغة أخرى");
    expect(spokenLanguageLabelForLocale("لغة محلية", "ar")).toBe("لغة محلية");
  });

  it("localizes current and coded trust reasons without exposing unknown English in Arabic", () => {
    expect(trustFlagReasonLabelForLocale("Marketplace violations", "ar")).toBe("مخالفات في السوق");
    expect(trustFlagReasonLabelForLocale("disputes_lost", "ar")).toBe("نزاعات خسرها البائع");
    expect(trustFlagReasonLabelForLocale("Unexpected internal reason", "ar")).toBe("يحتاج الحساب إلى مراجعة");
    expect(trustFlagReasonLabelForLocale("سبب مخصص", "ar")).toBe("سبب مخصص");
    expect(trustFlagReasonLabelForLocale("low_trust_score", "en")).toBe("Low trust score");
  });
});
