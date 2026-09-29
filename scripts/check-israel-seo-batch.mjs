/** Offline checks of actual page and metadata modules with UI fixtures.
 * No browser, database, network, provider credentials or real session is used.
 * This is NOT a complete Next.js build, production verification or ranking test.
 * Run: node scripts/check-israel-seo-batch.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const site = 'https://www.alphatraders.co.il';
const pages = ['buy-usdt-israel', 'learn-trading-free'];
const locales = ['en', 'ar'];
const jsx = (type, props) => typeof type === 'function' ? type(props ?? {}) : ({ type, props: props ?? {} });
function loader(env = {}) {
  const cache = new Map();
  const allowed = {
    '@/lib/site-url': 'src/lib/site-url.ts',
    '@/lib/seo': 'src/lib/seo.ts',
    '@/lib/seo-indexing': 'src/lib/seo-indexing.ts',
    '@/lib/seo-breadcrumb': 'src/lib/seo-breadcrumb.ts',
    '@/components/seo/public-discovery-breadcrumbs': 'src/components/seo/public-discovery-breadcrumbs.tsx',
    '@/components/academy/learning-next-step': 'src/components/academy/learning-next-step.tsx',
  };
  const fixtures = {
    'server-only': {},
    'next/link': { default: 'a' },
    '@/i18n/navigation': { Link: 'a' },
    '@/components/ui/button': { buttonVariants: () => 'button-fixture' },
    '@/components/academy/learning-share-actions': { LearningShareActions: 'test-share-actions' },
    '@/lib/brand': { BRAND_NAME: 'Alpha Traders Academy & Exchange', BRAND_PRIMARY_NAME: 'Alpha Traders', BRAND_SUPPORT_EMAIL: 'fixture@example.invalid', BRAND_OFFICIAL_SOCIALS: [] },
    '@/lib/public-trust': { getPublicTrustFaqs: () => [] },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
  };
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative).exports;
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    const output = ts.transpileModule(source, {
      fileName: relative,
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    });
    const errors = (output.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, `Syntax diagnostics: ${relative}`);
    const loadedModule = { exports: {} };
    cache.set(relative, loadedModule);
    vm.runInNewContext(output.outputText, {
      module: loadedModule, exports: loadedModule.exports, URL, process: { env: { ...env } },
      require(name) {
        if (Object.hasOwn(fixtures, name)) return fixtures[name];
        if (Object.hasOwn(allowed, name)) return load(allowed[name]);
        throw new Error(`Unapproved dependency ${name} in ${relative}`);
      },
    }, { filename: relative, timeout: 2000 });
    return loadedModule.exports;
  }
  return load;
}
function walk(value, predicate) {
  if (Array.isArray(value)) return value.flatMap(v => walk(v, predicate));
  if (!value || typeof value !== 'object') return [];
  return [...(predicate(value) ? [value] : []), ...walk(value.props?.children, predicate)];
}
function text(value) {
  if (Array.isArray(value)) return value.map(text).join(' ');
  if (value && typeof value === 'object') return value.type === 'script' ? '' : text(value.props?.children);
  return value == null || typeof value === 'boolean' ? '' : String(value);
}
function schemas(view) {
  return walk(view, v => v.type === 'script').map(v => {
    assert.equal(v.props.type, 'application/ld+json');
    assert.equal(v.props.src, undefined);
    const serialized = v.props.dangerouslySetInnerHTML.__html;
    assert.equal(serialized.includes('<'), false);
    return JSON.parse(serialized);
  });
}
const configurations = [
  ['default', {}, site],
  ['explicit-production', { NEXT_PUBLIC_SITE_URL: site }, site],
  ['configured-host', { NEXT_PUBLIC_SITE_URL: 'https://seo-fixture.example' }, 'https://seo-fixture.example'],
  ['trimmed-host', { NEXT_PUBLIC_SITE_URL: '  seo-fixture.example/  ' }, 'https://seo-fixture.example'],
  ['server-fallback', { NEXT_PUBLIC_SITE_URL: 'https://[', SITE_URL: 'https://server-fixture.example' }, 'https://server-fixture.example'],
  ['production-env-fallback', { VERCEL_PROJECT_PRODUCTION_URL: 'official-fixture.example', VERCEL_URL: 'preview-fixture.example' }, 'https://official-fixture.example'],
  ['preview-env-fallback', { VERCEL_URL: 'preview-fixture.example' }, 'https://preview-fixture.example'],
];
for (const locale of locales) {
  for (const [name, env, origin] of configurations) {
    test(`origin: ${locale}/${name} webpage matches canonical, breadcrumb, FAQ and site identity`, async () => {
      const load = loader(env);
      const page = load('src/app/[locale]/buy-usdt-israel/page.tsx');
      const props = { params: Promise.resolve({ locale }) };
      const metadata = await page.generateMetadata(props);
      const data = schemas(await page.default(props));
      const canonical = `${origin}/${locale}/buy-usdt-israel`;
      assert.equal(metadata.alternates.canonical, canonical);
      assert.equal(metadata.openGraph.url, canonical);
      assert.equal(data.find(x => x['@type'] === 'WebPage')['@id'], `${canonical}#webpage`);
      assert.equal(data.find(x => x['@type'] === 'FAQPage')['@id'], `${canonical}#faq`);
      assert.equal(data.find(x => x['@type'] === 'BreadcrumbList')['@id'], `${canonical}#breadcrumb`);
      const identity = load('src/lib/seo.ts').buildSiteIdentitySchemas();
      assert.equal(data.find(x => x['@type'] === 'WebPage').isPartOf['@id'], identity.find(x => x['@type'] === 'WebSite')['@id']);
      assert.equal(data.find(x => x['@type'] === 'WebPage').spatialCoverage.name, 'Israel');
      assert.equal(data.find(x => x['@type'] === 'WebPage').inLanguage, locale);
    });
  }
}
{
  for (const locale of locales) {
    for (const name of pages) {
      const load = loader({ NEXT_PUBLIC_SITE_URL: site });
      const page = load(`src/app/[locale]/${name}/page.tsx`);
      const props = { params: Promise.resolve({ locale }) };
      test(`${locale}/${name}: metadata locale parity and public indexability`, async () => {
        const m = await page.generateMetadata(props);
        assert.equal(m.alternates.canonical, `${site}/${locale}/${name}`);
        assert.equal(m.alternates.languages.en, `${site}/en/${name}`);
        assert.equal(m.alternates.languages.ar, `${site}/ar/${name}`);
        assert.equal(m.alternates.languages['x-default'], `${site}/en/${name}`);
        assert.notEqual(m.robots?.index, false);
        assert.equal(/[\u0600-\u06ff]/u.test(m.description), locale === 'ar');
      });
      test(`${locale}/${name}: one H1 and no form, network or application mutation dependency`, async () => {
        const view = await page.default(props);
        assert.equal(walk(view, x => x.type === 'h1').length, 1);
        assert.equal(walk(view, x => x.type === 'form').length, 0);
        assert.ok(schemas(view).length >= 2);
        const source = fs.readFileSync(path.join(root, `src/app/[locale]/${name}/page.tsx`), 'utf8');
        assert.doesNotMatch(source, /\bfetch\s*\(|\buse server\b|@\/lib\/(?:auth|postgres|commission|wallet)/);
      });
      test(`${locale}/${name}: FAQ remains identical to visible answers`, async () => {
        const view = await page.default(props);
        const faq = schemas(view).find(x => x['@type'] === 'FAQPage');
        assert.equal(faq.mainEntity.length, name === 'buy-usdt-israel' ? 7 : 3);
        for (const q of faq.mainEntity) {
          assert.ok(text(view).includes(q.name));
          assert.ok(text(view).includes(q.acceptedAnswer.text));
        }
      });
      test(`${locale}/${name}: accessible breadcrumbs match structured links and direction`, async () => {
        const view = await page.default(props);
        const breadcrumb = schemas(view).find(x => x['@type'] === 'BreadcrumbList');
        const nav = walk(view, x => x.type === 'nav');
        assert.equal(nav.length, 1);
        assert.equal(nav[0].props.dir, locale === 'ar' ? 'rtl' : 'ltr');
        const links = walk(nav[0], x => x.type === 'a');
        assert.equal(links.length, 2);
        links.forEach((link, i) => assert.equal(link.props.href, breadcrumb.itemListElement[i].item));
        assert.equal(walk(nav[0], x => x.props?.['aria-current'] === 'page').length, 1);
      });
    }
    test(`${locale}: course and marketplace links retain their intended handoffs`, async () => {
      const load = loader();
      const props = { params: Promise.resolve({ locale }) };
      const academy = await load('src/app/[locale]/learn-trading-free/page.tsx').default(props);
      const exchange = await load('src/app/[locale]/buy-usdt-israel/page.tsx').default(props);
      const lessonLinks = walk(academy, x => x.type === 'a').map(x => x.props.href);
      const courseHandoffs = lessonLinks.filter(x => typeof x === 'object');
      assert.equal(courseHandoffs.length, 2, 'hero and closing course links remain available');
      courseHandoffs.forEach(link => assert.equal(JSON.stringify(link), JSON.stringify({ pathname: '/login', query: { redirectTo: `/${locale}/academy` } })));
      const exchangeEntry = walk(academy, x => x.type === 'a' && text(x).includes('Alpha Exchange'));
      assert.equal(exchangeEntry.length, 1);
      assert.equal(exchangeEntry[0].props.href, '/usdt-exchange');
      assert.ok(!lessonLinks.some(x => typeof x === 'string' && x.includes('/lessons')));
      const exchangeLinks = walk(exchange, x => x.type === 'a').map(x => x.props.href);
      assert.ok(exchangeLinks.includes('/usdt-exchange'));
      assert.ok(exchangeLinks.includes('/safety-trust'));
      assert.ok(exchangeLinks.includes('/learn-trading-free'));
      assert.match(text(academy), locale === 'ar' ? /بريدًا إلكترونيًا مؤكدًا/ : /verified email/);
      assert.match(text(exchange), locale === 'ar' ? /تسجيل الدخول/ : /requires sign-in/);
    });
    test(`${locale}: academy has six unchanged topics with useful descriptions`, async () => {
      const view = await loader()('src/app/[locale]/learn-trading-free/page.tsx').default({ params: Promise.resolve({ locale }) });
      const grid = walk(view, x => x.type === 'div' && x.props.className === 'grid gap-3 md:grid-cols-2');
      assert.equal(grid.length, 1);
      const cards = grid[0].props.children;
      assert.equal(cards.length, 6);
      const headings = locale === 'ar'
        ? ['أساسيات الشموع وحركة السعر','النماذج الفنية','الدعم والمقاومة','الترندلاين وبنية السوق','إدارة المخاطر والانضباط','علم نفس التداول والتطبيق العملي']
        : ['Candlestick and price-action foundations','Chart patterns','Support and resistance','Trendlines and market structure','Risk management and discipline','Trading psychology and practical application'];
      cards.forEach((card, i) => {
        assert.equal(text(walk(card, x => x.type === 'h2')[0]), headings[i]);
        const paragraphs = walk(card, x => x.type === 'p');
        assert.equal(paragraphs.length, 2);
        assert.ok(text(paragraphs[1]).length > 60);
        assert.equal(/[\u0600-\u06ff]/u.test(text(paragraphs[1])), locale === 'ar');
      });
    });
    test(`${locale}: beginner course title leaves brand suffix to existing template`, async () => {
      const page = loader()('src/app/[locale]/learn-trading-free/page.tsx');
      const props = { params: Promise.resolve({ locale }) };
      const m = await page.generateMetadata(props);
      assert.equal(m.title, locale === 'ar' ? 'دورة تداول مجانية للمبتدئين' : 'Free Trading Course for Beginners');
      assert.equal(m.title.includes('Alpha Traders'), false);
      assert.ok(text(walk(await page.default(props), x => x.type === 'h1')[0]).includes(m.title));
    });
    test(`${locale}: risk warnings and no unverified awards, returns, fees or seller totals`, async () => {
      const load = loader();
      const academy = await load('src/app/[locale]/learn-trading-free/page.tsx').default({ params: Promise.resolve({ locale }) });
      const exchange = await load('src/app/[locale]/buy-usdt-israel/page.tsx').default({ params: Promise.resolve({ locale }) });
      assert.match(text(academy), locale === 'ar' ? /لا توجد أرباح مضمونة/ : /profits are never guaranteed/);
      assert.match(text(exchange), locale === 'ar' ? /لا تضمن/ : /does not guarantee/);
      for (const view of [academy, exchange]) for (const entry of schemas(view)) {
        assert.equal(entry.aggregateRating, undefined);
        assert.equal(entry.review, undefined);
        assert.equal(entry.offers, undefined);
      }
    });
  }
  test('private search inventory cannot silently lose an existing exclusion', () => {
    // Independent inventory: iterating only the implementation array would hide
    // a missing route by also deleting its generated regression test.
    // This freezes search policy, NOT an authentication/authorization decision.
    const expectedRoutes = [
      'admin', 'academy', 'dashboard', 'lessons', 'learn-with-mark', 'prop-firms', 'news', 'profile', 'settings',
      'notifications', 'trade-room', 'trades', 'usdt-exchange', 'seller',
      'onboarding', 'login', 'register', 'verify-account', 'verify-email',
      'forgot-password', 'reset-password',
    ];
    const indexing = loader()('src/lib/seo-indexing.ts');
    assert.deepEqual([...indexing.PRIVATE_SEARCH_ROUTE_NAMES].sort(), [...expectedRoutes].sort());
    for (const route of expectedRoutes) for (const prefix of ['', '/en', '/ar']) {
      assert.equal(indexing.isPrivateSearchPath(`${prefix}/${route}`), true);
      assert.equal(indexing.isPrivateSearchPath(`${prefix}/${route}/fixture?source=test#part`), true);
    }
  });
  test('shared private indexing rules remain intact for every protected route', () => {
    const load = loader();
    const indexing = load('src/lib/seo-indexing.ts');
    const seo = load('src/lib/seo.ts');
    for (const locale of locales) for (const route of indexing.PRIVATE_SEARCH_ROUTE_NAMES) {
      const path = `/${locale}/${route}`;
      assert.equal(indexing.isPrivateSearchPath(path), true);
      assert.equal(seo.buildPageMetadata({ locale, path, title: 'Fixture', description: 'Fixture' }).robots.index, false);
    }
  });
  test('JSON-LD cannot break out of a script element', () => {
    const seo = loader()('src/lib/seo.ts');
    const input = { description: '</script><script>alert(1)</script>' };
    const output = seo.serializeJsonLd(input);
    assert.equal(output.includes('<'), false);
    assert.deepEqual(JSON.parse(output), input);
  });
}
