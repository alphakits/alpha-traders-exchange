import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { resolveBuyerFixture, cleanupBuyerFixture, type BuyerFixture } from "./support/buyer-fixture";
import { provisionQaWorld, cleanupQaWorld, type QaWorld } from "./support/qa-accounts";
import { E2E_BASE_URL } from "./support/base-url";

const TEST_SUPPORT_HEADERS = { "x-alpha-test-support": "enabled" };

let world: QaWorld | undefined;
let buyerFixture: BuyerFixture | undefined;

async function login(ctx: APIRequestContext, email: string, password: string) {
  const res = await ctx.post("/api/auth/login", { data: { email, password, rememberMe: true } });
  expect(res.ok(), `login failed for ${email}`).toBeTruthy();
}

async function readState(ctx: APIRequestContext) {
  const res = await ctx.get("/api/testing/alpha-exchange-state", { headers: TEST_SUPPORT_HEADERS });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as Record<string, unknown>;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: E2E_BASE_URL });
  world = await provisionQaWorld(ctx);
  await ctx.dispose();
  buyerFixture = await resolveBuyerFixture((process.env.E2E_BUYER_EMAIL ?? "").toLowerCase(), process.env.E2E_BUYER_PASSWORD ?? "");
});

test.afterAll(async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: E2E_BASE_URL });
  await cleanupQaWorld(ctx, world);
  await cleanupBuyerFixture(buyerFixture);
  await ctx.dispose();
});

// ── Seller flow: accountable edit/removal enforcement + audit trail ──────────
test.describe("Seller flow · listing accountability", () => {
  test("blocks an amount/availability edit without a reason", async ({ request }) => {
    await login(request, world!.seller.email, world!.seller.password);
    const res = await request.patch(`/api/alpha-exchange/listings/${world!.listingId}`, {
      data: { availableAmount: "800", maximumTrade: "800" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/reason/i);
  });

  test("accepts the edit with a reason + explanation and records the audit trail", async ({ request }) => {
    await login(request, world!.seller.email, world!.seller.password);
    const res = await request.patch(`/api/alpha-exchange/listings/${world!.listingId}`, {
      data: { availableAmount: "800", maximumTrade: "800", changeReason: "Changed available balance", changeExplanation: "Sold part off-platform." },
    });
    expect(res.status()).toBe(200);

    const state = await readState(request);
    const audits = (state.auditLogs as Array<Record<string, unknown>>) ?? [];
    const edit = audits.find((a) => a.action === "listing_edited" && a.listingId === world!.listingId);
    expect(edit, "edit audit entry exists").toBeTruthy();
    expect(edit?.reason).toBe("Changed available balance");
    expect(edit?.oldValue).toMatchObject({ availableAmount: "1000" });
    expect(edit?.newValue).toMatchObject({ availableAmount: "800" });
  });

  test("blocks removal without a reason, then records it with one", async ({ request }) => {
    await login(request, world!.seller.email, world!.seller.password);
    const noReason = await request.delete(`/api/alpha-exchange/listings/${world!.listingId}`);
    expect(noReason.status()).toBe(400);

    const withReason = await request.delete(`/api/alpha-exchange/listings/${world!.listingId}`, {
      data: { changeReason: "Personal reason", changeExplanation: "Taking a short break." },
    });
    expect(withReason.status()).toBe(200);

    const state = await readState(request);
    const audits = (state.auditLogs as Array<Record<string, unknown>>) ?? [];
    const closed = audits.find((a) => a.action === "listing_closed" && a.listingId === world!.listingId);
    expect(closed?.reason).toBe("Personal reason");
  });
});

// ── Admin flow: Listing Reliability panel renders real deterministic data ────
test.describe("Admin flow · Listing Reliability", () => {
  test("admin dashboard exposes the Listing Reliability panel", async ({ page }) => {
    await login(page.request, world!.admin.email, world!.admin.password);
    await page.goto("/en/admin/alpha-exchange");
    await page.getByRole("button", { name: /Open Listing Reliability/i }).click();
    await expect(page.getByRole("heading", { name: "Listing Reliability" })).toBeVisible();
    const hasData = await page.getByText("Sellers tracked").first().isVisible().catch(() => false);
    if (hasData) {
      await expect(page.getByRole("columnheader", { name: /Cancellation %/ })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: /Avg\. lifetime/ })).toBeVisible();
      return;
    }
    await expect(page.getByText(/No seller reliability data available yet/i)).toBeVisible();
  });
});

// ── Buyer flow: direct Buy modal validation ─────────────────────────────────
test.describe("Buyer flow · Buy modal validation", () => {
  test("surfaces accessible validation and gates submit on required fields", async ({ page }) => {
    await login(page.request, buyerFixture!.email, buyerFixture!.password);
    await page.goto("/en/usdt-exchange");
    await page.getByRole("button", { name: /Buy USDT from/i }).first().click();

    await expect(page.getByRole("heading", { name: /^Buy USDT$/ })).toBeVisible();
    const amount = page.getByLabel(/USDT Amount/i);
    await expect(amount).toBeVisible();

    // Below-minimum amount marks the field invalid (not color-only — aria-invalid set).
    await amount.fill("1");
    await expect(amount).toHaveAttribute("aria-invalid", "true");

    // Submit stays disabled while the required receiving wallet is empty.
    await expect(page.getByRole("button", { name: /Start Trade/i })).toBeDisabled();
  });
});

// ── Mobile flow: no horizontal overflow across small viewports ──────────────
test.describe("Mobile flow · responsive integrity", () => {
  for (const width of [320, 360, 390]) {
    test(`marketplace has no horizontal overflow at ${width}px`, async ({ page }) => {
      await login(page.request, buyerFixture!.email, buyerFixture!.password);
      await page.setViewportSize({ width, height: 780 });
      await page.goto("/en/usdt-exchange");
      await page.getByRole("button", { name: /Buy USDT from/i }).first().waitFor({ state: "visible" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(1);
    });
  }

  test("Buy modal at 320px keeps the form reachable without overflow", async ({ page }) => {
    await login(page.request, buyerFixture!.email, buyerFixture!.password);
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto("/en/usdt-exchange");
    await page.getByRole("button", { name: /Buy USDT from/i }).first().click();
    await expect(page.getByLabel(/USDT Amount/i)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
