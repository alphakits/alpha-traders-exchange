import { describe, expect, it } from "vitest";
import { generateMetadata } from "@/app/[locale]/verify-email/layout";

describe("verify-email metadata", () => {
  it("returns private Arabic metadata for the Arabic route", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: "ar" }) });

    expect(metadata.title).toBe("تأكيد البريد الإلكتروني");
    expect(metadata.description).toContain("تأكيد بريدك الإلكتروني");
    expect(metadata.openGraph).toMatchObject({ locale: "ar_IL" });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("returns private English metadata for the English route", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: "en" }) });

    expect(metadata.title).toBe("Verify Email");
    expect(metadata.description).toContain("Complete email verification");
    expect(metadata.openGraph).toMatchObject({ locale: "en_US" });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
