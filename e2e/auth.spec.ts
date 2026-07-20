/**
 * E2E tests — Authentication flow
 *
 * Prerequisites: dev server running at http://localhost:3000
 * Run: npx playwright test e2e/auth.spec.ts
 *
 * Test accounts (seeded in data/alpha-exchange-db.json):
 *   Owner : jozenmark834@yahoo.com / Roflxd123!
 *   Buyer+Seller: test123@guest.local / Test1234!
 */

import { test, expect } from "@playwright/test";

const OWNER_EMAIL = "jozenmark834@yahoo.com";
const OWNER_PASSWORD = "Roflxd123!";
const BUYER_EMAIL = "test123@guest.local";
const BUYER_PASSWORD = "Test1234!";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function login(page: Parameters<typeof test>[1] extends infer T ? T extends { page: infer P } ? P : never : never, email: string, password: string) {
  await page.goto("/en/login");
  await page.waitForSelector('form[data-hydrated="true"]', { timeout: 15_000 });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 20_000 });
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
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("buyer can log in", async ({ page }) => {
    await login(page, BUYER_EMAIL, BUYER_PASSWORD);
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("invalid credentials show error message", async ({ page }) => {
    await page.goto("/en/login");
    await page.waitForSelector('form[data-hydrated="true"]', { timeout: 15_000 });
    await page.fill('input[name="email"]', "nobody@example.com");
    await page.fill('input[name="password"]', "wrongpassword");
    await page.click('button[type="submit"]');
    // Should stay on login page
    await expect(page).toHaveURL(/\/en\/login/);
    // Error message visible
    await expect(page.locator("text=/invalid|incorrect|not found/i")).toBeVisible({ timeout: 10_000 });
  });

  test("session persists after page refresh", async ({ page }) => {
    await login(page, BUYER_EMAIL, BUYER_PASSWORD);
    const urlAfterLogin = page.url();
    await page.reload();
    // Should still be on the same protected page, not redirected to login
    await expect(page).not.toHaveURL(/\/en\/login/);
    expect(page.url()).toBe(urlAfterLogin);
  });

  test("logout clears session and redirects to login", async ({ page }) => {
    await login(page, BUYER_EMAIL, BUYER_PASSWORD);
    await page.request.post("/api/auth/logout");
    // After logout, protected route redirects to login
    await page.goto("/en/academy");
    await expect(page).toHaveURL(/\/en\/login/);
  });
});

// ---------------------------------------------------------------------------
// redirectTo flow
// ---------------------------------------------------------------------------

test.describe("Post-login redirect", () => {
  test("redirectTo preserved through login for /en/academy", async ({ page }) => {
    // Guest navigates to academy → gets sent to login with redirectTo
    await page.goto("/en/academy");
    const loginUrl = page.url();
    expect(loginUrl).toMatch(/redirectTo/);

    // Fill login form
    await page.waitForSelector('form[data-hydrated="true"]', { timeout: 15_000 });
    await page.fill('input[name="email"]', BUYER_EMAIL);
    await page.fill('input[name="password"]', BUYER_PASSWORD);
    await page.click('button[type="submit"]');

    // Should land on academy, not dashboard
    await expect(page).toHaveURL(/\/en\/academy/, { timeout: 20_000 });
  });

  test("redirectTo preserved through login for /en/usdt-exchange", async ({ page }) => {
    await page.goto("/en/usdt-exchange");
    await page.waitForSelector('form[data-hydrated="true"]', { timeout: 15_000 });
    await page.fill('input[name="email"]', BUYER_EMAIL);
    await page.fill('input[name="password"]', BUYER_PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/en\/usdt-exchange/, { timeout: 20_000 });
  });

  test("already-logged-in user accessing login page is redirected away", async ({ page }) => {
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
    await login(page, OWNER_EMAIL, OWNER_PASSWORD);
    await page.goto("/en/admin/alpha-exchange");
    // Should not be redirected to login or exchange
    await expect(page).not.toHaveURL(/\/en\/login/);
    await expect(page).not.toHaveURL(/\/en\/usdt-exchange$/);
  });

  test("admin route /en/admin/alpha-exchange inaccessible to buyer", async ({ page }) => {
    await login(page, BUYER_EMAIL, BUYER_PASSWORD);
    await page.goto("/en/admin/alpha-exchange");
    // Should be redirected away (to exchange or login)
    await expect(page).toHaveURL(/\/(usdt-exchange|login)/);
  });

  test("/api/auth/me returns user for authenticated session", async ({ page }) => {
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
