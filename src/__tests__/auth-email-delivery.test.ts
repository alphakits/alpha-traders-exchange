import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthEmail, sendAuthEmailViaResend } from "@/lib/auth-email-delivery";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("auth email branding", () => {
  it.each([
    ["verification", "en"],
    ["verification", "ar"],
    ["recovery", "en"],
    ["recovery", "ar"],
  ] as const)("renders the current logo in the %s %s email", (kind, locale) => {
    const email = buildAuthEmail(kind, locale, "https://www.alphatraders.co.il/secure-action");

    expect(email.html).toContain('src="cid:alpha-traders-logo"');
    expect(email.html).toContain('width="120" height="120"');
    expect(email.html).toContain("Alpha Traders Academy &amp; Exchange");
    expect(email.subject).toContain("Alpha Traders Academy & Exchange");
    expect(email.html).toContain("max-width:560px");
    expect(email.html).toContain("https://www.alphatraders.co.il/secure-action");
  });

  it("embeds the approved logo and sender-brand selector in Resend deliveries", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-api-key");
    vi.stubEnv("EMAIL_FROM", "Alpha Exchange <notifications@example.com>");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const email = buildAuthEmail("verification", "en", "https://www.alphatraders.co.il/secure-action");

    await expect(sendAuthEmailViaResend({
      to: "mark@example.com",
      ...email,
    })).resolves.toEqual({ ok: true });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual(expect.objectContaining({
      from: "Alpha Traders Academy & Exchange <notifications@example.com>",
      headers: { "BIMI-Selector": "v=BIMI1; s=default;" },
      attachments: [{
        path: "https://www.alphatraders.co.il/images/brand/alpha-traders-logo-192.png?v=c73f7405",
        filename: "alpha-traders-logo.png",
        content_id: "alpha-traders-logo",
      }],
    }));
  });
});
