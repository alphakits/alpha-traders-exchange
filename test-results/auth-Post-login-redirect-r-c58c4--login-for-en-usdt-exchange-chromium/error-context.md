# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> Post-login redirect >> redirectTo preserved through login for /en/usdt-exchange
- Location: e2e\auth.spec.ts:151:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/en/usdt-exchange
Call log:
  - navigating to "http://localhost:3000/en/usdt-exchange", waiting until "load"

```

# Test source

```ts
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
  125 |     await page.goto("/en/academy");
  126 |     await expect(page).toHaveURL(/\/en\/login/);
  127 |   });
  128 | });
  129 | 
  130 | // ---------------------------------------------------------------------------
  131 | // redirectTo flow
  132 | // ---------------------------------------------------------------------------
  133 | 
  134 | test.describe("Post-login redirect", () => {
  135 |   test("redirectTo preserved through login for /en/academy", async ({ page }) => {
  136 |     // Guest navigates to academy → gets sent to login with redirectTo
  137 |     await page.goto("/en/academy");
  138 |     const loginUrl = page.url();
  139 |     expect(loginUrl).toMatch(/redirectTo/);
  140 | 
  141 |     // Fill login form
  142 |     await page.waitForSelector('form[data-hydrated="true"]', { timeout: 15_000 });
  143 |     await page.getByPlaceholder("Email").fill(BUYER_EMAIL);
  144 |     await page.getByPlaceholder("Password").fill(BUYER_PASSWORD);
  145 |     await page.click('button[type="submit"]');
  146 | 
  147 |     // Should land on academy, not dashboard
  148 |     await expect(page).toHaveURL(/\/en\/academy/, { timeout: 20_000 });
  149 |   });
  150 | 
  151 |   test("redirectTo preserved through login for /en/usdt-exchange", async ({ page }) => {
> 152 |     await page.goto("/en/usdt-exchange");
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/en/usdt-exchange
  153 |     await page.waitForSelector('form[data-hydrated="true"]', { timeout: 15_000 });
  154 |     await page.getByPlaceholder("Email").fill(BUYER_EMAIL);
  155 |     await page.getByPlaceholder("Password").fill(BUYER_PASSWORD);
  156 |     await page.click('button[type="submit"]');
  157 |     await expect(page).toHaveURL(/\/en\/usdt-exchange/, { timeout: 20_000 });
  158 |   });
  159 | 
  160 |   test("already-logged-in user accessing login page is redirected away", async ({ page }) => {
  161 |     await login(page, BUYER_EMAIL, BUYER_PASSWORD);
  162 |     await page.goto("/en/login");
  163 |     // Should not stay on login — middleware or page should redirect
  164 |     await page.waitForTimeout(2000);
  165 |     // Acceptable: redirected away OR stays (no infinite loop)
  166 |     const finalUrl = page.url();
  167 |     // Should not loop back to login with an error
  168 |     expect(finalUrl).not.toMatch(/error=|loop/);
  169 |   });
  170 | });
  171 | 
  172 | // ---------------------------------------------------------------------------
  173 | // Role-based access
  174 | // ---------------------------------------------------------------------------
  175 | 
  176 | test.describe("Role-based access", () => {
  177 |   test("admin route /en/admin/alpha-exchange accessible to owner", async ({ page }) => {
  178 |     await login(page, OWNER_EMAIL, OWNER_PASSWORD);
  179 |     await page.goto("/en/admin/alpha-exchange");
  180 |     // Should not be redirected to login or exchange
  181 |     await expect(page).not.toHaveURL(/\/en\/login/);
  182 |     await expect(page).not.toHaveURL(/\/en\/usdt-exchange$/);
  183 |   });
  184 | 
  185 |   test("admin route /en/admin/alpha-exchange inaccessible to buyer", async ({ page }) => {
  186 |     await login(page, BUYER_EMAIL, BUYER_PASSWORD);
  187 |     await page.goto("/en/admin/alpha-exchange");
  188 |     // Should be redirected away (to exchange or login)
  189 |     await expect(page).toHaveURL(/\/(usdt-exchange|login)/);
  190 |   });
  191 | 
  192 |   test("/api/auth/me returns user for authenticated session", async ({ page }) => {
  193 |     await login(page, BUYER_EMAIL, BUYER_PASSWORD);
  194 |     const resp = await page.request.get("/api/auth/me");
  195 |     expect(resp.status()).toBe(200);
  196 |     const body = await resp.json();
  197 |     expect(body.user).toBeTruthy();
  198 |     expect(body.user.email).toBe(BUYER_EMAIL);
  199 |   });
  200 | 
  201 |   test("/api/auth/me returns null for unauthenticated request", async ({ page }) => {
  202 |     // Fresh context — no cookies
  203 |     const resp = await page.request.get("/api/auth/me");
  204 |     expect(resp.status()).toBe(200);
  205 |     const body = await resp.json();
  206 |     expect(body.user).toBeNull();
  207 |   });
  208 | });
  209 | 
  210 | // ---------------------------------------------------------------------------
  211 | // Health check
  212 | // ---------------------------------------------------------------------------
  213 | 
  214 | test.describe("Infrastructure", () => {
  215 |   test("health endpoint returns ok", async ({ page }) => {
  216 |     const resp = await page.request.get("/api/health");
  217 |     expect(resp.status()).toBe(200);
  218 |     const body = await resp.json();
  219 |     expect(body.status).toBe("ok");
  220 |     expect(body.checks.database).toBe("ok");
  221 |   });
  222 | 
  223 |   test("security headers present on HTML responses", async ({ page }) => {
  224 |     const resp = await page.goto("/en");
  225 |     const headers = resp!.headers();
  226 |     expect(headers["x-content-type-options"]).toBe("nosniff");
  227 |     expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
  228 |     expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  229 |   });
  230 | });
  231 | 
```