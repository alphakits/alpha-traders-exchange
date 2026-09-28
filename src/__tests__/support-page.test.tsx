import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SupportPage from "@/app/[locale]/support/page";

describe("SupportPage", () => {
  it("gives an English reviewer one-tap email and an in-page support form", async () => {
    render(await SupportPage({ params: Promise.resolve({ locale: "en" }) }));

    expect(screen.getByRole("link", { name: "support@alphatraders.co.il" }).getAttribute("href"))
      .toBe("mailto:support@alphatraders.co.il?subject=Alpha%20Traders%20support%20request");
    expect(screen.getByRole("form", { name: "Send us a message" })).toBeTruthy();
    expect((screen.getByLabelText(/Subject/) as HTMLInputElement).value).toBe("Alpha Traders support request");
  });

  it("keeps the direct support path fully localized in Arabic", async () => {
    render(await SupportPage({ params: Promise.resolve({ locale: "ar" }) }));

    expect(screen.getByRole("form", { name: "أرسل لنا رسالة" })).toBeTruthy();
    expect((screen.getByLabelText(/الموضوع/) as HTMLInputElement).value).toBe("طلب دعم Alpha Traders");
    expect(screen.getByText(/لا ترسل كلمة المرور/)).toBeTruthy();
  });
});
