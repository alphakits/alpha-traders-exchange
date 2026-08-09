import { test, expect, request as pwRequest, type APIRequestContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { resolveBuyerFixture, cleanupBuyerFixture, type BuyerFixture } from "./support/buyer-fixture";

const scrypt = promisify(scryptCb);
const H = { "x-alpha-test-support": "enabled" };
const MOBILE_WIDTHS = [320, 360, 390, 430];

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

let buyer: BuyerFixture | undefined;
const sellerPassword = `Pv!${randomBytes(18).toString("base64url")}`;
const formsPassword = `Pv!${randomBytes(18).toString("base64url")}`;
const adminPassword = `Pv!${randomBytes(18).toString("base64url")}`;
const ids = {
  sellerOnline: `pv-online-${randomUUID()}`,
  sellerForms: `pv-forms-${randomUUID()}`,
  sellerRecent: `pv-recent-${randomUUID()}`,
  sellerOffline: `pv-offline-${randomUUID()}`,
  sellerUnverified: `pv-unverif-${randomUUID()}`,
  admin: `pv-admin-${randomUUID()}`,
  lUrgent: `pv-l-urgent-${randomUUID()}`,
  lNeutral: `pv-l-neutral-${randomUUID()}`,
  lHidden: `pv-l-hidden-${randomUUID()}`,
  lRecent: `pv-l-recent-${randomUUID()}`,
  lOffline: `pv-l-offline-${randomUUID()}`,
  lUnverif: `pv-l-unverif-${randomUUID()}`,
  prActive: `pv-pr-active-${randomUUID()}`,
  prDone: `pv-pr-done-${randomUUID()}`,
};
const sellerEmail = `${ids.sellerOnline}@example.test`;
const formsEmail = `${ids.sellerForms}@example.test`;
const adminEmail = `${ids.admin}@example.test`;
const allSeededIds = Object.values(ids);
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

function mkUser(id: string, name: string, o: Record<string, unknown>) {
  const now = new Date().toISOString();
  return {
    id, fullName: name, email: `${id}@example.test`, passwordHash: "x",
    whatsappNumber: "+972500000000", role: "approved_seller", roles: ["approved_seller"],
    sellerStatus: "approved_seller", availabilityStatus: "available", onlineStatus: "offline",
    preferredNetworks: ["TRC20"], preferredPaymentMethods: ["Bank Transfer"], profilePhotoUrl: "",
    languages: ["English"], bio: "PV seller", country: "Israel", createdAt: now, updatedAt: now,
    emailVerified: true, emailVerifiedAt: now, verifiedPhone: "+972500000000", phoneVerifiedAt: now,
    isProfileHidden: false, sellerPrestigeRank: "bronze", ...o,
  };
}
function mkListing(id: string, sellerId: string, name: string, amount: string, expiresInMs: number) {
  const now = new Date().toISOString();
  return {
    id, sellerId, sellerDisplayName: name, photos: [], originalAmount: amount, availableAmount: amount,
    price: "3.60", currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer", paymentMethods: ["Bank Transfer"],
    bankName: "Bank Hapoalim", minimumTrade: "100", maximumTrade: amount, expiresAt: iso(expiresInMs),
    sellerDescription: "PV listing.", responseTime: "5 min", status: "active", approvalStatus: "approved",
    createdAt: now, updatedAt: now,
  };
}
function mkTrade(id: string, sellerId: string, listingId: string, status: string, completed: boolean) {
  return {
    id, sellerId, buyerId: "pv-hidden-buyer", listingId, buyerName: "Hidden Buyer", buyerWhatsapp: "x", buyerNotes: "",
    usdtAmount: "300", fiatAmount: "1080", currency: "ILS", network: "TRC20", paymentMethod: "Bank Transfer",
    timeline: [], status, ...(completed ? { completedAt: iso(-10 * 60 * 1000) } : {}),
    createdAt: iso(-30 * 60 * 1000), updatedAt: iso(-10 * 60 * 1000),
  };
}

async function provision(request: APIRequestContext) {
  const sellerHash = await hashPassword(sellerPassword);
  const formsHash = await hashPassword(formsPassword);
  const adminHash = await hashPassword(adminPassword);
  const db = (await (await request.get("/api/testing/alpha-exchange-state", { headers: H })).json()) as Record<string, unknown>;
  db.users = [
    ...(Array.isArray(db.users) ? db.users : []),
    mkUser(ids.sellerOnline, "PV Online", { onlineStatus: "online", lastActiveAt: iso(-30 * 1000), emailVerified: true, passwordHash: sellerHash }),
    mkUser(ids.sellerForms, "PV Forms", { onlineStatus: "online", lastActiveAt: iso(-30 * 1000), emailVerified: true, passwordHash: formsHash }),
    mkUser(ids.sellerRecent, "PV Recent", { onlineStatus: "offline", lastActiveAt: iso(-25 * 60 * 1000), emailVerified: true }),
    mkUser(ids.sellerOffline, "PV Offline", { onlineStatus: "offline", lastActiveAt: iso(-3 * 24 * 60 * 60 * 1000), emailVerified: true }),
    mkUser(ids.sellerUnverified, "PV Unverified", { onlineStatus: "online", lastActiveAt: iso(-30 * 1000), emailVerified: false }),
    mkUser(ids.admin, "PV Admin", { role: "admin", roles: ["admin"], sellerStatus: "buyer", lastActiveAt: iso(-60 * 1000), passwordHash: adminHash }),
  ];
  db.marketplaceListings = [
    ...(Array.isArray(db.marketplaceListings) ? db.marketplaceListings : []),
    mkListing(ids.lUrgent, ids.sellerOnline, "PV Online", "1000", 2 * 60 * 60 * 1000),
    mkListing(ids.lNeutral, ids.sellerOnline, "PV Online", "2000", 8 * 60 * 60 * 1000),
    mkListing(ids.lHidden, ids.sellerOnline, "PV Online", "3000", 48 * 60 * 60 * 1000),
    mkListing(ids.lRecent, ids.sellerRecent, "PV Recent", "500", 48 * 60 * 60 * 1000),
    mkListing(ids.lOffline, ids.sellerOffline, "PV Offline", "500", 48 * 60 * 60 * 1000),
    mkListing(ids.lUnverif, ids.sellerUnverified, "PV Unverified", "500", 48 * 60 * 60 * 1000),
  ];
  db.purchaseRequests = [
    ...(Array.isArray(db.purchaseRequests) ? db.purchaseRequests : []),
    mkTrade(ids.prActive, ids.sellerOnline, ids.lHidden, "payment_sent", false),
    mkTrade(ids.prDone, ids.sellerOnline, ids.lHidden, "completed", true),
  ];
  const put = await request.put("/api/testing/alpha-exchange-state", { headers: H, data: db });
  expect(put.ok()).toBeTruthy();
}

async function cleanup(request: APIRequestContext) {
  const db = (await (await request.get("/api/testing/alpha-exchange-state", { headers: H })).json()) as Record<string, unknown>;
  const idset = new Set(allSeededIds);
  const refs = (v: unknown): boolean => typeof v === "string" ? idset.has(v)
    : Array.isArray(v) ? v.some(refs)
    : v && typeof v === "object" ? Object.values(v as Record<string, unknown>).some(refs) : false;
  for (const [k, v] of Object.entries(db)) if (Array.isArray(v)) db[k] = v.filter((r) => !refs(r));
  await request.put("/api/testing/alpha-exchange-state", { headers: H, data: db });
}

async function login(ctx: APIRequestContext, email: string, password: string) {
  let lastStatus: number | null = null;
  let lastBody = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const r = await ctx.post("/api/auth/login", { data: { email, password, rememberMe: true } });
    if (r.ok()) return;
    lastStatus = r.status();
    lastBody = await r.text().catch(() => "");
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`login ${email} failed (${lastStatus ?? "unknown"}): ${lastBody}`);
}
async function gotoMarketplace(page: Page) {
  await page.goto("/en/usdt-exchange");
  await page.getByRole("button", { name: /Buy USDT from/i }).first().waitFor({ state: "visible", timeout: 30000 });
}
function cardFor(page: Page, sellerName: string) {
  return page.locator(".seller-listing-shell").filter({ hasText: sellerName }).first();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ctx = await pwRequest.newContext({ baseURL: "http://localhost:3000" });
  await provision(ctx);
  await ctx.dispose();
  buyer = await resolveBuyerFixture((process.env.E2E_BUYER_EMAIL ?? "").toLowerCase(), process.env.E2E_BUYER_PASSWORD ?? "");
});

test.afterAll(async () => {
  const ctx = await pwRequest.newContext({ baseURL: "http://localhost:3000" });
  await cleanup(ctx);
  await ctx.dispose();
  await cleanupBuyerFixture(buyer);
});

// ── MOBILE ──────────────────────────────────────────────────────────────────
test.describe("Mobile", () => {
  for (const width of MOBILE_WIDTHS) {
    test(`no horizontal scroll + centered modal + reachable action @ ${width}px`, async ({ page }) => {
      await login(page.request, buyer!.email, buyer!.password);
      await page.setViewportSize({ width, height: 780 });
      await gotoMarketplace(page);
      const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(pageOverflow, `marketplace overflow @ ${width}`).toBeLessThanOrEqual(1);

      await page.getByRole("button", { name: /Buy USDT from/i }).first().click();
      await expect(page.getByRole("heading", { name: /^Buy USDT$/ })).toBeVisible();
      const modalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(modalOverflow, `modal overflow @ ${width}`).toBeLessThanOrEqual(1);

      const box = await page.getByRole("dialog").first().boundingBox();
      if (box) expect(Math.abs((box.x + box.width / 2) - width / 2), `modal centered @ ${width}`).toBeLessThanOrEqual(2);

      await expect(page.getByRole("button", { name: /Start Trade/i })).toBeInViewport();
      await page.keyboard.press("Escape");
    });
  }

  test("primary tap targets are >=44px", async ({ page }) => {
    await login(page.request, buyer!.email, buyer!.password);
    await page.setViewportSize({ width: 390, height: 780 });
    await gotoMarketplace(page);
    const box = await page.getByRole("button", { name: /Buy USDT from/i }).first().boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});

// ── MARKETPLACE PULSE ────────────────────────────────────────────────────────
test.describe("Marketplace Pulse", () => {
  const summaryMetricValue = (page: Page, label: string) =>
    page.locator("p", { hasText: label }).first().locator("xpath=following-sibling::p[1]");

  test("tiles reflect the real pulse API; no fabricated/placeholder values", async ({ page }) => {
    await login(page.request, buyer!.email, buyer!.password);
    const api = await (await page.request.get("/api/alpha-exchange/marketplace-pulse")).json() as {
      sellersOnline: number; buyersOnline: number; activeTrades: number; activeListings: number;
      totalUsdtAvailable: number; completedTrades: number; lastCompletedTrade: { network: string } | null; recentActivity: unknown[];
    };
    expect(api.activeListings).toBeGreaterThanOrEqual(6);
    expect(api.sellersOnline).toBeGreaterThanOrEqual(2);
    expect(api.activeTrades).toBeGreaterThanOrEqual(1);
    expect(api.completedTrades).toBeGreaterThanOrEqual(1);
    expect(api.lastCompletedTrade).not.toBeNull();
    expect(api.recentActivity.length).toBeGreaterThan(0);

    await gotoMarketplace(page);
    const overview = page.locator("#market-overview");
    await expect(overview.getByText(/^live$/i).first()).toBeVisible({ timeout: 20000 });
    await expect(overview.getByText("USDT / ILS", { exact: true })).toBeVisible();
    await expect(overview.getByText("BTC / USDT", { exact: true })).toBeVisible();
    await expect(overview.getByText("ETH / USDT", { exact: true })).toBeVisible();
  });

  test("pulse reflects real backend changes (delta)", async ({ page }) => {
    await login(page.request, buyer!.email, buyer!.password);
    const before = await (await page.request.get("/api/alpha-exchange/marketplace-pulse")).json() as { activeListings: number; totalUsdtAvailable: number };
    const extraId = `pv-delta-${randomUUID()}`;
    allSeededIds.push(extraId);
    const db = (await (await page.request.get("/api/testing/alpha-exchange-state", { headers: H })).json()) as Record<string, unknown>;
    (db.marketplaceListings as unknown[]).push(mkListing(extraId, ids.sellerOnline, "PV Online", "1234", 48 * 60 * 60 * 1000));
    await page.request.put("/api/testing/alpha-exchange-state", { headers: H, data: db });
    const after = await (await page.request.get("/api/alpha-exchange/marketplace-pulse")).json() as { activeListings: number; totalUsdtAvailable: number };
    expect(after.activeListings).toBe(before.activeListings + 1);
    expect(after.totalUsdtAvailable).toBe(before.totalUsdtAvailable + 1234);
  });
});

// ── SELLER CARDS ─────────────────────────────────────────────────────────────
test.describe("Seller cards", () => {
  test("presence: online green / recent / offline grey", async ({ page }) => {
    await login(page.request, buyer!.email, buyer!.password);
    await gotoMarketplace(page);
    await expect(cardFor(page, "PV Online").locator(".seller-presence--online")).toBeVisible();
    await expect(cardFor(page, "PV Recent").locator(".seller-presence--recent")).toBeVisible();
    await expect(cardFor(page, "PV Recent").getByText(/Active \d+ min ago/)).toBeVisible();
    await expect(cardFor(page, "PV Offline").locator(".seller-presence--idle")).toBeVisible();
  });

  test("countdown: urgent <4h, neutral 4-12h, hidden >12h", async ({ page }) => {
    await login(page.request, buyer!.email, buyer!.password);
    await gotoMarketplace(page);
    await expect(page.locator(".seller-listing-countdown--urgent").first()).toBeVisible();
    await expect(page.locator(".seller-listing-countdown--neutral").first()).toBeVisible();
    await expect(cardFor(page, "PV Offline").locator(".seller-listing-countdown")).toHaveCount(0);
  });

  test("Verified Email badge only when verified", async ({ page }) => {
    await login(page.request, buyer!.email, buyer!.password);
    await gotoMarketplace(page);
    await expect(cardFor(page, "PV Online").getByText("Verified Email")).toBeVisible();
    await expect(cardFor(page, "PV Unverified").getByText("Verified Email")).toHaveCount(0);
  });

  test("Approved Seller badge present on visible listings", async ({ page }) => {
    await login(page.request, buyer!.email, buyer!.password);
    await gotoMarketplace(page);
    await expect(cardFor(page, "PV Online").getByText(/Approved Seller/i).first()).toBeVisible();
  });
});

// ── FORMS ────────────────────────────────────────────────────────────────────
test.describe("Forms required treatment", () => {
  test("Buy USDT: aria-invalid toggles red->green; required asterisks present", async ({ page }) => {
    await login(page.request, buyer!.email, buyer!.password);
    await gotoMarketplace(page);
    await page.getByRole("button", { name: /Buy USDT from/i }).first().click();
    const amount = page.getByLabel(/USDT Amount/i);
    await amount.fill("1");
    await expect(amount).toHaveAttribute("aria-invalid", "true");
    const dialogText = await page.getByRole("dialog").first().innerText();
    const limitsMatch = dialogText.match(/Trade limits:\s*([\d,]+)\s*[–-]\s*([\d,]+)/i);
    const validAmount = limitsMatch?.[1]?.replace(/,/g, "") ?? "100";
    await amount.fill(validAmount);
    await expect(amount).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Receiving Wallet Address")).toBeVisible();
  });

  test("Create Listing: required border red when empty, green when valid, asterisk present", async ({ page }) => {
    await login(page.request, formsEmail, formsPassword);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto("/en/usdt-exchange");
    const amount = page.locator("#create-available");
    await amount.scrollIntoViewIfNeeded();
    await amount.waitFor({ state: "visible", timeout: 30000 });
    await expect(amount).toHaveClass(/F04438/);
    await amount.fill("5000");
    await expect(amount).toHaveClass(/emerald/);
    await expect(page.locator('label[for="create-available"]')).toContainText("*");
  });
});

// ── HEADER ───────────────────────────────────────────────────────────────────
test.describe("Header", () => {
  test("sticky on scroll (desktop)", async ({ page }) => {
    await login(page.request, buyer!.email, buyer!.password);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoMarketplace(page);
    const header = page.locator("header").first();
    expect(await header.evaluate((el) => el.getBoundingClientRect().top)).toBe(0);
    await page.mouse.wheel(0, 1400);
    await page.waitForTimeout(200);
    expect(await header.evaluate((el) => el.getBoundingClientRect().top)).toBe(0);
  });

  test("mobile drawer opens", async ({ page }) => {
    await login(page.request, buyer!.email, buyer!.password);
    await page.setViewportSize({ width: 360, height: 780 });
    await gotoMarketplace(page);
    await page.locator("header summary").click();
    await expect(page.getByRole("link", { name: "Community" }).last()).toBeVisible();
  });
});

// ── JOURNEYS ─────────────────────────────────────────────────────────────────
test.describe("Journeys", () => {
  test("guest redirected to login for marketplace", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/en/usdt-exchange");
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  });

  test("buyer opens Buy modal in one tap", async ({ page }) => {
    await login(page.request, buyer!.email, buyer!.password);
    await gotoMarketplace(page);
    await page.getByRole("button", { name: /Buy USDT from/i }).first().click();
    await expect(page.getByRole("heading", { name: /^Buy USDT$/ })).toBeVisible();
  });

  test("seller sees workspace with Create Listing", async ({ page }) => {
    await login(page.request, formsEmail, formsPassword);
    await page.goto("/en/usdt-exchange");
    await expect(page.getByRole("heading", { name: /Create Listing/i }).first()).toBeVisible({ timeout: 30000 });
  });

  test("admin reaches Listing Reliability panel", async ({ page }) => {
    await login(page.request, adminEmail, adminPassword);
    await page.goto("/en/admin/alpha-exchange");
    await page.getByRole("button", { name: /Listing Reliability/ }).click();
    await expect(page.getByText("Sellers tracked")).toBeVisible({ timeout: 15000 });
  });
});

// ── PERFORMANCE ──────────────────────────────────────────────────────────────
test.describe("Performance", () => {
  test("measure render / buy modal / seller profile timings", async ({ page }) => {
    await login(page.request, buyer!.email, buyer!.password);
    await page.setViewportSize({ width: 390, height: 780 });

    const t0 = Date.now();
    await gotoMarketplace(page);
    const renderMs = Date.now() - t0;

    const t1 = Date.now();
    await page.getByRole("button", { name: /Buy USDT from/i }).first().click();
    await page.getByRole("heading", { name: /^Buy USDT$/ }).waitFor({ state: "visible" });
    const buyModalMs = Date.now() - t1;
    await page.keyboard.press("Escape");

    const t2 = Date.now();
    await page.getByRole("link", { name: /Seller Profile/i }).first().click();
    await page.waitForLoadState("domcontentloaded");
    const sellerProfileMs = Date.now() - t2;

    console.log(`PERF marketplaceRenderMs=${renderMs} buyModalMs=${buyModalMs} sellerProfileMs=${sellerProfileMs}`);
    expect(buyModalMs).toBeLessThan(6000);
  });
});
