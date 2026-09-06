import { describe, expect, it } from "vitest";
import { trustedWebUrl } from "../../apps/mobile/src/navigation/trusted-web-links";

describe("native trusted website links", () => {
  it("keeps account and legal handoffs on the production origin", () => {
    expect(trustedWebUrl("forgotPassword", "ar")).toBe(
      "https://www.alphatraders.co.il/ar/forgot-password",
    );
    expect(trustedWebUrl("accountSettings", "en")).toBe(
      "https://www.alphatraders.co.il/en/settings",
    );
    expect(trustedWebUrl("accountDeletion", "en")).toBe(
      "https://www.alphatraders.co.il/en/account-deletion",
    );
    expect(trustedWebUrl("privacyPolicy", "ar")).toBe(
      "https://www.alphatraders.co.il/ar/privacy-policy",
    );
    expect(trustedWebUrl("terms", "en")).toBe(
      "https://www.alphatraders.co.il/en/terms",
    );
    expect(trustedWebUrl("support", "ar")).toBe(
      "https://www.alphatraders.co.il/ar/support",
    );
  });
});
