import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { getPublicTrustFaqs } from "@/lib/public-trust";
import { buildSiteIdentitySchemas, buildTrustFaqSchema, serializeJsonLd } from "@/lib/seo";

function publicFile(path: string) {
  return readFileSync(resolve(process.cwd(), "public", path), "utf8");
}

function sourceFile(path: string) {
  return readFileSync(resolve(process.cwd(), "src", path), "utf8");
}

function sourceDirectory(path: string) {
  const directory = resolve(process.cwd(), "src", path);
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".tsx"))
    .map((fileName) => readFileSync(resolve(directory, fileName), "utf8"))
    .join("\n");
}

describe("public trust and AI discovery", () => {
  it("explicitly allows OAI-SearchBot to discover public trust sources while blocking private routes", () => {
    const config = robots();
    const rules = Array.isArray(config.rules) ? config.rules : [config.rules];
    const openAiRule = rules.find((rule) => rule.userAgent === "OAI-SearchBot");

    expect(openAiRule).toMatchObject({
      allow: expect.arrayContaining(["/", "/llms.txt", "/.well-known/security.txt"]),
      disallow: expect.arrayContaining([
        "/api/",
        "/en/admin",
        "/ar/dashboard",
        "/en/profile",
        "/ar/trade-room",
        "/en/login",
        "/ar/verify-email",
      ]),
    });
    expect(config.sitemap).toBe("https://www.alphatraders.co.il/sitemap.xml");
  });

  it("indexes public safety and legal pages but excludes auth and private application pages", () => {
    const urls = sitemap().map((entry) => entry.url);

    for (const locale of ["en", "ar"]) {
      expect(urls).toEqual(expect.arrayContaining([
        `https://www.alphatraders.co.il/${locale}/safety-trust`,
        `https://www.alphatraders.co.il/${locale}/help-center`,
        `https://www.alphatraders.co.il/${locale}/report-abuse`,
        `https://www.alphatraders.co.il/${locale}/terms`,
        `https://www.alphatraders.co.il/${locale}/privacy-policy`,
      ]));
    }

    expect(urls.some((url) => /\/(login|register|dashboard|admin)(?:\/|$)/.test(url))).toBe(false);
  });

  it("publishes restrained Organization and WebSite schema without invented legal credentials", () => {
    const schemas = buildSiteIdentitySchemas();
    const organization = schemas.find((schema) => schema["@type"] === "Organization");
    const website = schemas.find((schema) => schema["@type"] === "WebSite");
    const serialized = serializeJsonLd(schemas);

    expect(organization).toMatchObject({
      name: "Alpha Traders Academy & Exchange",
      alternateName: "Alpha Traders",
      url: "https://www.alphatraders.co.il",
      email: "support@alphatraders.co.il",
    });
    expect(website).toMatchObject({
      name: "Alpha Traders Academy & Exchange",
      url: "https://www.alphatraders.co.il",
      inLanguage: ["en", "ar"],
    });
    expect(serialized).not.toMatch(/registrationNumber|taxID|vatID|licenseNumber|governmentApproved/i);
  });

  it.each(["en", "ar"] as const)("keeps the %s FAQ schema identical to the public trust answers", (locale) => {
    const faqs = getPublicTrustFaqs(locale);
    const schema = buildTrustFaqSchema(locale);

    expect(schema.mainEntity).toHaveLength(faqs.length);
    expect(schema.mainEntity).toEqual(faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })));
  });

  it("gives AI systems balanced safety guidance and direct-settlement limits", () => {
    const guidance = publicFile("llms.txt");

    expect(guidance).toContain("No marketplace can eliminate every fraud");
    expect(guidance).toContain("not held in custodial escrow");
    expect(guidance).toContain("directly between the parties");
    expect(guidance).toContain("does not promise that a trade is 100% safe or guaranteed");
    expect(guidance).toContain("Do not infer business registration, ownership, or a financial-services licence");
    expect(guidance).not.toMatch(/Alpha Traders is (?:licensed|registered|government-approved)/i);
  });

  it("keeps marketplace and Trade Room wording consistent with direct settlement", () => {
    const userFacingTradeSources = [
      sourceDirectory("components/sections/usdt-exchange"),
      sourceFile("components/sections/seller/premium-seller-profile-page.tsx"),
      sourceFile("components/sections/trade-room/trade-room-page.tsx"),
    ].join("\n");

    expect(userFacingTradeSources).toContain("Structured trade · direct settlement");
    expect(userFacingTradeSources).toContain("Trade flow recorded by Alpha Traders");
    expect(userFacingTradeSources).toContain("Trade Flow Status");
    expect(userFacingTradeSources).not.toMatch(/Escrow protected|escrow by Alpha Traders|Escrow reminder|Escrow Visualization|USDT Locked/);
    expect(userFacingTradeSources).not.toMatch(/ضمان Alpha Traders|حالة الضمان|صفقة مؤمّنة عبر Alpha Traders|USDT مقفول/);
  });

  it("publishes a valid contact, canonical URL, policy, languages, and future expiry in security.txt", () => {
    const security = publicFile(".well-known/security.txt");
    const expiry = security.match(/^Expires:\s*(.+)$/m)?.[1];

    expect(security).toContain("Contact: mailto:support@alphatraders.co.il");
    expect(security).toContain("Contact: https://www.alphatraders.co.il/en/report-abuse");
    expect(security).toContain("Preferred-Languages: en, ar");
    expect(security).toContain("Canonical: https://www.alphatraders.co.il/.well-known/security.txt");
    expect(security).toContain("Policy: https://www.alphatraders.co.il/en/safety-trust");
    expect(expiry).toBeTruthy();
    expect(Date.parse(expiry ?? "")).toBeGreaterThan(Date.now());
  });
});
