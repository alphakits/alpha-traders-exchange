/* Offline regression checks of actual SEO/page modules with small UI fixtures.
 * No HTTP, database or real browser/device access. Not an indexing guarantee.
 * Run: node scripts/check-public-discovery.mjs
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => fs.readFileSync(root + path, "utf8");
const site = "https://www.alphatraders.co.il";
const jsx = (type, props) => ({ type, props: props ?? {} });
function load(path, dependencies = {}) {
  const output = ts.transpileModule(read(path), {
    fileName: path, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  assert.equal(output.diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0, path);
  const module = { exports: {} };
  vm.runInNewContext(output.outputText, {
    module, exports: module.exports,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (name === "server-only") return {};
      if (name === "@/lib/site-url") return { getSiteUrl: () => site };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      throw new Error(`Unexpected dependency ${name} in ${path}`);
    },
  });
  return module.exports;
}
const indexing = load("src/lib/seo-indexing.ts");
const seo = load("src/lib/seo.ts", {
  "@/lib/seo-indexing": indexing,
  "@/lib/brand": { BRAND_NAME: "Alpha Traders", BRAND_PRIMARY_NAME: "Alpha Traders", BRAND_SUPPORT_EMAIL: "test@example.invalid", BRAND_OFFICIAL_SOCIALS: [] },
  "@/lib/public-trust": { getPublicTrustFaqs: () => [] },
});
const breadcrumb = load("src/lib/seo-breadcrumb.ts");
const robots = load("src/app/robots.ts", { "@/lib/seo-indexing": indexing }).default();
const sitemap = load("src/app/sitemap.ts").default();
const pages = ["start", "learn-trading-free", "buy-usdt-israel"];
const variants = ["en", "ar"];
const page = (name) => load(`src/app/[locale]/${name}/page.tsx`, {
  "@/lib/seo": seo,
  "@/lib/seo-breadcrumb": breadcrumb,
  "@/i18n/navigation": { Link: "test-link" },
  "@/components/ui/button": { buttonVariants: () => "test-button" },
});
function walk(value, predicate) {
  if (Array.isArray(value)) return value.flatMap((child) => walk(child, predicate));
  if (!value || typeof value !== "object") return [];
  return [...(predicate(value) ? [value] : []), ...walk(value.props?.children, predicate)];
}
function visibleText(value) {
  if (Array.isArray(value)) return value.map(visibleText).join(" ");
  if (value && typeof value === "object") return value.type === "script" ? "" : visibleText(value.props?.children);
  return value == null || typeof value === "boolean" ? "" : String(value);
}
for (const route of indexing.PRIVATE_SEARCH_ROUTE_NAMES) {
  test(`private metadata stays noindex: ${route}`, () => {
    for (const locale of variants) {
      for (const path of [`/${route}`, `/${route}/synthetic`, `/${locale}/${route}?next=example#part`]) {
        assert.equal(indexing.isPrivateSearchPath(path), true);
        const metadata = seo.buildPageMetadata({ locale, path, title: "Fixture", description: "Fixture" });
        assert.equal(metadata.robots.index, false);
        assert.equal(metadata.robots.follow, false);
      }
      for (const rule of robots.rules) assert.ok(rule.disallow.includes(`/${locale}/${route}`));
    }
  });
}
test("route policy does not hide similarly named public pages", () => {
  for (const path of ["", "/", "/en", "/ar", "/seller-disclaimer", "/academy-guide", ...pages.map((p) => `/${p}`)]) {
    assert.equal(indexing.isPrivateSearchPath(path), false, path);
  }
  assert.equal(indexing.isPrivateSearchPath("/api/private"), true);
});
for (const locale of variants) {
  for (const name of pages) {
    test(`${locale}/${name}: canonical, locale alternatives and social metadata agree`, async () => {
      const metadata = await page(name).generateMetadata({ params: Promise.resolve({ locale }) });
      assert.equal(metadata.alternates.canonical, `${site}/${locale}/${name}`);
      assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
      assert.equal(metadata.alternates.languages.ar, `${site}/ar/${name}`);
      assert.equal(metadata.alternates.languages.en, `${site}/en/${name}`);
      assert.equal(metadata.alternates.languages["x-default"], `${site}/en/${name}`);
      assert.notEqual(metadata.robots?.index, false);
      assert.equal(/[\u0600-\u06ff]/u.test(metadata.description), locale === "ar");
      assert.ok(metadata.title.length > 10 && metadata.description.length > 30);
    });
    test(`${locale}/${name}: one heading, valid breadcrumbs and FAQ matching visible content`, async () => {
      const view = await page(name).default({ params: Promise.resolve({ locale }) });
      assert.equal(walk(view, (node) => node.type === "h1").length, 1);
      const data = walk(view, (node) => node.type === "script" && node.props.type === "application/ld+json")
        .map((node) => JSON.parse(node.props.dangerouslySetInnerHTML.__html));
      const trail = data.find((entry) => entry["@type"] === "BreadcrumbList");
      assert.ok(trail);
      assert.equal(trail.itemListElement.at(-1).item, `${site}/${locale}/${name}`);
      trail.itemListElement.forEach((item, index) => assert.equal(item.position, index + 1));
      const faq = data.find((entry) => entry["@type"] === "FAQPage");
      assert.ok(faq?.mainEntity.length);
      const text = visibleText(view);
      for (const item of faq.mainEntity) {
        assert.ok(text.includes(item.name));
        assert.ok(text.includes(item.acceptedAnswer.text));
      }
      assert.equal(walk(view, (node) => node.type === "form").length, 0);
    });
  }
  test(`${locale}: course handoff preserves locale and existing sign-in destination`, async () => {
    const view = await page("learn-trading-free").default({ params: Promise.resolve({ locale }) });
    const links = walk(view, (node) => node.type === "test-link").map((node) => node.props.href);
    assert.ok(links.some((href) => typeof href === "object" && href.pathname === "/login" && href.query?.redirectTo === `/${locale}/academy`));
    assert.ok(!links.some((href) => typeof href === "string" && href.startsWith("/lessons/")));
  });
  test(`${locale}: marketplace guide uses the existing gated exchange entry`, async () => {
    const view = await page("buy-usdt-israel").default({ params: Promise.resolve({ locale }) });
    assert.ok(walk(view, (node) => node.type === "test-link").some((node) => node.props.href === "/usdt-exchange"));
  });
}
test("sitemap contains unique official public URLs and all six discovery variants", () => {
  const urls = sitemap.map((entry) => entry.url);
  assert.equal(urls.length, new Set(urls).size);
  for (const url of urls) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, site);
    assert.equal(indexing.isPrivateSearchPath(parsed.pathname), false, url);
  }
  for (const locale of variants) for (const name of pages) assert.ok(urls.includes(`${site}/${locale}/${name}`));
});
test("crawler policy retains private exclusions and the public discovery allowance", () => {
  assert.equal(robots.sitemap, `${site}/sitemap.xml`);
  assert.ok(robots.rules.some((rule) => rule.userAgent === "*" && rule.allow === "/"));
  const ai = robots.rules.find((rule) => rule.userAgent === "OAI-SearchBot");
  assert.ok(ai);
  for (const locale of variants) for (const name of pages) assert.ok(ai.allow.includes(`/${locale}/${name}`));
  for (const rule of robots.rules) assert.ok(rule.disallow.includes("/api/"));
});
test("JSON-LD serialization prevents script-breakout text", () => {
  const input = { description: "</script><script>example</script>" };
  const output = seo.serializeJsonLd(input);
  assert.equal(output.includes("<"), false);
  assert.equal(JSON.parse(output).description, input.description);
});
test("founder description matches the requested language", async () => {
  const founder = load("src/app/[locale]/founder/page.tsx", {
    "@/lib/seo": seo, "@/components/sections/founder/founder-page": { FounderPage: "fixture-founder" },
  });
  for (const locale of variants) {
    const metadata = await founder.generateMetadata({ params: Promise.resolve({ locale }) });
    assert.equal(/[\u0600-\u06ff]/u.test(metadata.description), locale === "ar");
    assert.equal(metadata.alternates.canonical, `${site}/${locale}/founder`);
  }
});
test("production build retains the owner gate and requires discovery tests", () => {
  const { scripts } = JSON.parse(read("package.json"));
  assert.match(scripts.build, /npm run test:seo-discovery && npm run test:owner-analytics && node scripts\/build-production\.mjs/);
  assert.equal(scripts["test:seo-discovery"], "node scripts/check-public-discovery.mjs");
});
