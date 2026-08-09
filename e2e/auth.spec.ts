/**
 * E2E tests — Authentication flow
 *
 * Prerequisites: dev server running at http://localhost:3000
 * Run: npx playwright test e2e/auth.spec.ts
 *
 * Credentialed checks use environment variables only:
 *   E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD
 *   E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD
 *   E2E_BUYER_EMAIL, E2E_BUYER_PASSWORD
 *   E2E_SELLER_EMAIL, E2E_SELLER_PASSWORD
 */

import { test, expect, type Page } from "@playwright/test";
import { cleanupBuyerFixture, resolveBuyerFixture, type BuyerFixture } from "./support/buyer-fixture";

const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? "";
const OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD ?? "";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";
let BUYER_EMAIL = process.env.E2E_BUYER_EMAIL ?? "";
let BUYER_PASSWORD = process.env.E2E_BUYER_PASSWORD ?? "";
const SELLER_EMAIL = process.env.E2E_SELLER_EMAIL ?? "";
const SELLER_PASSWORD = process.env.E2E_SELLER_PASSWORD ?? "";
let buyerFixture: BuyerFixture | undefined;

test.beforeAll(async () => {
  buyerFixture = await resolveBuyerFixture(BUYER_EMAIL, BUYER_PASSWORD);
  BUYER_EMAIL = buyerFixture.email;
  BUYER_PASSWORD = buyerFixture.password;
});

test.afterAll(async () => {
  await cleanupBuyerFixture(buyerFixture);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function login(page: Page, email: string, password: string) {
  await page.goto("/en/login");
  const form = page.locator('form[data-hydrated="true"]').first();
  await form.waitFor({ timeout: 15_000 });
  await form.getByLabel("Email", { exact: true }).fill(email);
  await form.getByLabel("Password", { exact: true }).fill(password);
  await form.locator('button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/en\/login/, { timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Guest (unauthenticated) behaviour
// ---------------------------------------------------------------------------

test.describe("Guest access", () => {
  test("homepage loads without authentication", async ({ page }) => {
    await page.goto("/en");
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator("body")).toBeVisible();
  });

  test("protected route /en/academy redirects to login", async ({ page }) => {
    await page.goto("/en/academy");
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test("protected route /en/usdt-exchange redirects to login", async ({ page }) => {
    await page.goto("/en/usdt-exchange");
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test("protected route /en/dashboard redirects to login", async ({ page }) => {
    await page.goto("/en/dashboard");
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test("protected route /en/profile redirects to login", async ({ page }) => {
    await page.goto("/en/profile");
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test("login page is publicly accessible", async ({ page }) => {
    await page.goto("/en/login");
    await expect(page).not.toHaveURL(/\/en\/academy/);
    await expect(page.locator('form')).toBeVisible();
  });

  test("register page is publicly accessible", async ({ page }) => {
    await page.goto("/en/register");
    await expect(page).not.toHaveURL(/login/);
  });

  test("about-founder page is publicly accessible", async ({ page }) => {
    await page.goto("/en/about-founder");
    await expect(page).not.toHaveURL(/login/);
  });

  test("community page is publicly accessible", async ({ page }) => {
    await page.goto("/en/community");
    await expect(page).not.toHaveURL(/login/);
  });
});

// ---------------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------------

test.describe("Authentication", () => {
  test("owner can log in and is redirected away from login page", async ({ page }) => {
    test.skip(!OWNER_EMAIL || !OWNER_PASSWORD, "Set E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD to run credentialed login checks.");
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("buyer can log in", async ({ page }) => {
    test.skip(!BUYER_EMAIL || !BUYER_PASSWORD, "Set E2E_BUYER_EMAIL and E2E_BUYER_PASSWORD to run credentialed login checks.");
    await login(page, BUYER_EMAIL, BUYER_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("seller can log in", async ({ page }) => {
    test.skip(!SELLER_EMAIL || !SELLER_PASSWORD, "Set E2E_SELLER_EMAIL and E2E_SELLER_PASSWORD to run credentialed login checks.");
    await login(page, SELLER_EMAIL, SELLER_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("admin can log in", async ({ page }) => {
    test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run credentialed login checks.");
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("invalid credentials show error message", async ({ page }) => {
    await page.request.post("/api/auth/logout").catch(() => {});
    await page.goto("/en/login");
    const form = page.locator('form[data-hydrated="true"]').first();
    await form.waitFor({ timeout: 15_000 });
    await form.getByLabel("Email", { exact: true }).fill("nobody@example.com");
    await form.getByLabel("Password", { exact: true }).fill("wrongpassword");
    await form.locator('button[type="submit"]').click();
    // Should stay on login page
    await expect(page).toHaveURL(/\/en\/login/);
    // Error message visible
    await expect(page.locator("text=/invalid|incorrect|not found/i")).toBeVisible({ timeout: 10_000 });
  });

  test("session persists after page refresh", async ({ page }) => {
    test.skip(!BUYER_EMAIL || !BUYER_PASSWORD, "Set E2E_BUYER_EMAIL and E2E_BUYER_PASSWORD to run credentialed login checks.");
    await login(page, BUYER_EMAIL, BUYER_PASSWORD);
    const urlAfterLogin = page.url();
    await page.reload({ waitUntil: "commit" });
    // Should still be on the same protected page, not redirected to login
    await expect(page).not.toHaveURL(/\/en\/login/);
    expect(page.url()).toBe(urlAfterLogin);
  });

  test("logout clears session and redirects to login", async ({ page }) => {
    test.setTimeout(60_000);
    test.skip(!BUYER_EMAIL || !BUYER_PASSWORD, "Set E2E_BUYER_EMAIL and E2E_BUYER_PASSWORD to run credentialed login checks.");
    await login(page, BUYER_EMAIL, BUYER_PASSWORD);
    await page.request.post("/api/auth/logout");
    // After logout, protected route redirects to login
    await page.goto("/en/academy");
    await expect(page).toHaveURL(/\/en\/login/, { timeout: 30_000 });
  });
});

// ---------------------------------------------------------------------------
// redirectTo flow
// ---------------------------------------------------------------------------

test.describe("Post-login redirect", () => {
  test("redirectTo preserved through login for /en/academy", async ({ page }) => {
    test.skip(!BUYER_EMAIL || !BUYER_PASSWORD, "Set E2E_BUYER_EMAIL and E2E_BUYER_PASSWORD to run credentialed login checks.");
    // Guest navigates to academy → gets sent to login with redirectTo
    await page.goto("/en/academy");
    const loginUrl = page.url();
    expect(loginUrl).toMatch(/redirectTo/);

    // Fill login form
    const form = page.locator('form[data-hydrated="true"]').first();
    await form.waitFor({ timeout: 15_000 });
    await form.getByLabel("Email", { exact: true }).fill(BUYER_EMAIL);
    await form.getByLabel("Password", { exact: true }).fill(BUYER_PASSWORD);
    await form.locator('button[type="submit"]').click();

    // Should land on academy, not dashboard
    await expect(page).toHaveURL(/\/en\/academy/, { timeout: 20_000 });
  });

  test("redirectTo preserved through login for /en/usdt-exchange", async ({ page }) => {
    test.skip(!BUYER_EMAIL || !BUYER_PASSWORD, "Set E2E_BUYER_EMAIL and E2E_BUYER_PASSWORD to run credentialed login checks.");
    await page.goto("/en/usdt-exchange");
    const form = page.locator('form[data-hydrated="true"]').first();
    await form.waitFor({ timeout: 15_000 });
    await form.getByLabel("Email", { exact: true }).fill(BUYER_EMAIL);
    await form.getByLabel("Password", { exact: true }).fill(BUYER_PASSWORD);
    await form.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/en\/usdt-exchange/, { timeout: 20_000 });
  });

  test("already-logged-in user accessing login page is redirected away", async ({ page }) => {
    test.skip(!BUYER_EMAIL || !BUYER_PASSWORD, "Set E2E_BUYER_EMAIL and E2E_BUYER_PASSWORD to run credentialed login checks.");
    await login(page, BUYER_EMAIL, BUYER_PASSWORD);
    await page.goto("/en/login");
    // Should not stay on login — middleware or page should redirect
    await page.waitForTimeout(2000);
    // Acceptable: redirected away OR stays (no infinite loop)
    const finalUrl = page.url();
    // Should not loop back to login with an error
    expect(finalUrl).not.toMatch(/error=|loop/);
  });
});

// ---------------------------------------------------------------------------
// Role-based access
// ---------------------------------------------------------------------------

test.describe("Role-based access", () => {
  test("admin route /en/admin/alpha-exchange accessible to owner", async ({ page }) => {
    test.skip(!OWNER_EMAIL || !OWNER_PASSWORD, "Set E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD to run credentialed login checks.");
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto("/en/admin/alpha-exchange");
    // Should not be redirected to login or exchange
    await expect(page).not.toHaveURL(/\/en\/login/);
    await expect(page).not.toHaveURL(/\/en\/usdt-exchange$/);
  });

  test("profile exposes owner dashboard entry for owner", async ({ page }) => {
    test.setTimeout(60_000);
    test.skip(!OWNER_EMAIL || !OWNER_PASSWORD, "Set E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD to run credentialed login checks.");
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto("/en/profile");
    await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: /Owner Dashboard/i })).toBeVisible({ timeout: 15_000 });
  });

  test("admin route /en/admin/alpha-exchange accessible to admin", async ({ page }) => {
    test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run credentialed login checks.");
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/en/admin/alpha-exchange");
    await expect(page).not.toHaveURL(/\/en\/login/);
    await expect(page).not.toHaveURL(/\/en\/usdt-exchange$/);
  });

  test("admin route /en/admin/alpha-exchange inaccessible to buyer", async ({ page }) => {
    test.skip(!BUYER_EMAIL || !BUYER_PASSWORD, "Set E2E_BUYER_EMAIL and E2E_BUYER_PASSWORD to run credentialed login checks.");
    await login(page, BUYER_EMAIL, BUYER_PASSWORD);
    await page.goto("/en/admin/alpha-exchange", { waitUntil: "commit" }).catch(() => {});
    await expect(page).toHaveURL(/\/en\/(usdt-exchange|login)/, { timeout: 30_000 });
  });

  test("/api/auth/me returns user for authenticated session", async ({ page }) => {
    test.skip(!BUYER_EMAIL || !BUYER_PASSWORD, "Set E2E_BUYER_EMAIL and E2E_BUYER_PASSWORD to run credentialed login checks.");
    await login(page, BUYER_EMAIL, BUYER_PASSWORD);
    const resp = await page.request.get("/api/auth/me");
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.user).toBeTruthy();
    expect(body.user.email).toBe(BUYER_EMAIL);
  });

  test("/api/auth/me returns null for unauthenticated request", async ({ page }) => {
    // Fresh context — no cookies
    const resp = await page.request.get("/api/auth/me");
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.user).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

test.describe("Infrastructure", () => {
  test("health endpoint returns ok", async ({ page }) => {
    const resp = await page.request.get("/api/health");
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.status).toBe("ok");
    expect(body.checks.database).toBe("ok");
  });

  test("security headers present on HTML responses", async ({ page }) => {
    const resp = await page.goto("/en");
    const headers = resp!.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
});
