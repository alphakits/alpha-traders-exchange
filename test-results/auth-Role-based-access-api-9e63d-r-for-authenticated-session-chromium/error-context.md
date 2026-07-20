# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> Role-based access >> /api/auth/me returns user for authenticated session
- Location: e2e\auth.spec.ts:192:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/en/login
Call log:
  - navigating to "http://localhost:3000/en/login", waiting until "load"

```

# Test source

```ts
  1   | /**
  2   |  * E2E tests — Authentication flow
  3   |  *
  4   |  * Prerequisites: dev server running at http://localhost:3000
  5   |  * Run: npx playwright test e2e/auth.spec.ts
  6   |  *
  7   |  * Test accounts (seeded in data/alpha-exchange-db.json):
  8   |  *   Owner : jozenmark834@yahoo.com / Roflxd123!
  9   |  *   Buyer+Seller: test123@guest.local / test123
  10  |  */
  11  | 
  12  | import { test, expect } from "@playwright/test";
  13  | 
  14  | const OWNER_EMAIL = "jozenmark834@yahoo.com";
  15  | const OWNER_PASSWORD = "Roflxd123!";
  16  | const BUYER_EMAIL = "test123@guest.local";
  17  | const BUYER_PASSWORD = "test123";
  18  | 
  19  | // ---------------------------------------------------------------------------
  20  | // Helpers
  21  | // ---------------------------------------------------------------------------
  22  | 
  23  | async function login(page: Parameters<typeof test>[1] extends infer T ? T extends { page: infer P } ? P : never : never, email: string, password: string) {
> 24  |   await page.goto("/en/login");
      |              ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/en/login
  25  |   await page.waitForSelector('form[data-hydrated="true"]', { timeout: 15_000 });
  26  |   await page.getByPlaceholder("Email").fill(email);
  27  |   await page.getByPlaceholder("Password").fill(password);
  28  |   await page.click('button[type="submit"]');
  29  |   await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 20_000 });
  30  | }
  31  | 
  32  | // ---------------------------------------------------------------------------
  33  | // Guest (unauthenticated) behaviour
  34  | // ---------------------------------------------------------------------------
  35  | 
  36  | test.describe("Guest access", () => {
  37  |   test("homepage loads without authentication", async ({ page }) => {
  38  |     await page.goto("/en");
  39  |     await expect(page).not.toHaveURL(/login/);
  40  |     await expect(page.locator("body")).toBeVisible();
  41  |   });
  42  | 
  43  |   test("protected route /en/academy redirects to login", async ({ page }) => {
  44  |     await page.goto("/en/academy");
  45  |     await expect(page).toHaveURL(/\/en\/login/);
  46  |   });
  47  | 
  48  |   test("protected route /en/usdt-exchange redirects to login", async ({ page }) => {
  49  |     await page.goto("/en/usdt-exchange");
  50  |     await expect(page).toHaveURL(/\/en\/login/);
  51  |   });
  52  | 
  53  |   test("protected route /en/dashboard redirects to login", async ({ page }) => {
  54  |     await page.goto("/en/dashboard");
  55  |     await expect(page).toHaveURL(/\/en\/login/);
  56  |   });
  57  | 
  58  |   test("protected route /en/profile redirects to login", async ({ page }) => {
  59  |     await page.goto("/en/profile");
  60  |     await expect(page).toHaveURL(/\/en\/login/);
  61  |   });
  62  | 
  63  |   test("login page is publicly accessible", async ({ page }) => {
  64  |     await page.goto("/en/login");
  65  |     await expect(page).not.toHaveURL(/\/en\/academy/);
  66  |     await expect(page.locator('form')).toBeVisible();
  67  |   });
  68  | 
  69  |   test("register page is publicly accessible", async ({ page }) => {
  70  |     await page.goto("/en/register");
  71  |     await expect(page).not.toHaveURL(/login/);
  72  |   });
  73  | 
  74  |   test("about-founder page is publicly accessible", async ({ page }) => {
  75  |     await page.goto("/en/about-founder");
  76  |     await expect(page).not.toHaveURL(/login/);
  77  |   });
  78  | 
  79  |   test("community page is publicly accessible", async ({ page }) => {
  80  |     await page.goto("/en/community");
  81  |     await expect(page).not.toHaveURL(/login/);
  82  |   });
  83  | });
  84  | 
  85  | // ---------------------------------------------------------------------------
  86  | // Login / logout
  87  | // ---------------------------------------------------------------------------
  88  | 
  89  | test.describe("Authentication", () => {
  90  |   test("owner can log in and is redirected away from login page", async ({ page }) => {
  91  |     await login(page, OWNER_EMAIL, OWNER_PASSWORD);
  92  |     await expect(page).not.toHaveURL(/\/login/);
  93  |   });
  94  | 
  95  |   test("buyer can log in", async ({ page }) => {
  96  |     await login(page, BUYER_EMAIL, BUYER_PASSWORD);
  97  |     await expect(page).not.toHaveURL(/\/login/);
  98  |   });
  99  | 
  100 |   test("invalid credentials show error message", async ({ page }) => {
  101 |     await page.goto("/en/login");
  102 |     await page.waitForSelector('form[data-hydrated="true"]', { timeout: 15_000 });
  103 |     await page.getByPlaceholder("Email").fill("nobody@example.com");
  104 |     await page.getByPlaceholder("Password").fill("wrongpassword");
  105 |     await page.click('button[type="submit"]');
  106 |     // Should stay on login page
  107 |     await expect(page).toHaveURL(/\/en\/login/);
  108 |     // Error message visible
  109 |     await expect(page.locator("text=/invalid|incorrect|not found/i")).toBeVisible({ timeout: 10_000 });
  110 |   });
  111 | 
  112 |   test("session persists after page refresh", async ({ page }) => {
  113 |     await login(page, BUYER_EMAIL, BUYER_PASSWORD);
  114 |     const urlAfterLogin = page.url();
  115 |     await page.reload();
  116 |     // Should still be on the same protected page, not redirected to login
  117 |     await expect(page).not.toHaveURL(/\/en\/login/);
  118 |     expect(page.url()).toBe(urlAfterLogin);
  119 |   });
  120 | 
  121 |   test("logout clears session and redirects to login", async ({ page }) => {
  122 |     await login(page, BUYER_EMAIL, BUYER_PASSWORD);
  123 |     await page.request.post("/api/auth/logout");
  124 |     // After logout, protected route redirects to login
```