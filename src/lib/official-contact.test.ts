import { describe, expect, it } from "vitest";

import { getOfficialOwnerWhatsAppUrl } from "@/lib/official-contact";

describe("official owner contact configuration", () => {
  it("fails closed when missing or invalid", () => {
    expect(getOfficialOwnerWhatsAppUrl("")).toBeNull();
    expect(getOfficialOwnerWhatsAppUrl("http://wa.me/123")).toBeNull();
    expect(getOfficialOwnerWhatsAppUrl("https://example.com/123")).toBeNull();
  });

  it("accepts only supported HTTPS WhatsApp destinations", () => {
    expect(getOfficialOwnerWhatsAppUrl("https://wa.me/123"))
      .toBe("https://wa.me/123");
    expect(getOfficialOwnerWhatsAppUrl("https://api.whatsapp.com/send?phone=123"))
      .toBe("https://api.whatsapp.com/send?phone=123");
  });
});
