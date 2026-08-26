import { describe, expect, it } from "vitest";
import { buildAuthEmail } from "@/lib/auth-email-delivery";

describe("auth email branding", () => {
  it.each([
    ["verification", "en"],
    ["verification", "ar"],
    ["recovery", "en"],
    ["recovery", "ar"],
  ] as const)("renders the current logo in the %s %s email", (kind, locale) => {
    const email = buildAuthEmail(kind, locale, "https://www.alphatraders.co.il/secure-action");

    expect(email.html).toContain("/images/brand/alpha-traders-logo.png");
    expect(email.html).toContain("Alpha Traders Academy &amp; Exchange");
    expect(email.html).toContain("max-width:560px");
    expect(email.html).toContain("https://www.alphatraders.co.il/secure-action");
  });
});
