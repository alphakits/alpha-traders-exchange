import { createHash, randomUUID } from "node:crypto";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "./support/base-url";

const supportHeaders = { "x-alpha-test-support": "enabled" };
const createdIds = new Set<string>();
const displacedUsers: User[] = [];
for (const locale of ["en", "ar"] as const) for (const width of [390, 1440]) {
  test(`adult confirmation persists after retry and reload: ${locale} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const label = locale === "en" ? "I confirm that I am 18 or older." : "أؤكد أن عمري 18 عامًا أو أكثر.";
    await page.goto(`/${locale}/register`);
    await expect(page.getByRole("checkbox", { name: label, exact: true })).not.toBeChecked();
    await page.screenshot({ path: testInfo.outputPath(`adult-register-${locale}-${width}.png`), fullPage: true });
    const user = await provision(page.request, "buyer", true, undefined, undefined, false);
    await login(page, user);
    const denied = await page.request.get("/api/alpha-exchange/listings");
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "AGE_CONFIRMATION_REQUIRED" });
    await page.goto(`/${locale}/usdt-exchange`);
    await expect(page).toHaveURL(/\/verify-account\?redirectTo=/);
    const save = page.getByRole("button", { name: locale === "en" ? "Save confirmation" : "حفظ التأكيد", exact: true });
    await expect(save).toBeDisabled();
    await page.getByRole("checkbox", { name: label, exact: true }).check();
    await page.route("**/api/auth/age-eligibility", async route => {
      await page.unroute("**/api/auth/age-eligibility");
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary test interruption" }) });
    });
    await save.click();
    await expect(page.getByRole("alert").last()).toBeVisible();
    await expect(save).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`adult-confirmation-retry-${locale}-${width}.png`), fullPage: true });
    await save.click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/usdt-exchange$`));
    await page.reload();
    expect((await page.request.get("/api/alpha-exchange/listings")).ok()).toBeTruthy();
    expect((await (await page.request.get("/api/auth/me")).json()).user.adultConfirmed).toBe(true);
    const saved = (await state(page.request)).users.find(item => item.id === user.id);
    expect(saved?.ageEligibility).toMatchObject({ method: "self_attestation_v1", confirmedAt: expect.any(String) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
type User = Record<string, unknown> & { id: string; email: string };
type State = Record<string, unknown> & { users: User[] };
type Role = "guest" | "buyer" | "approved_seller" | "pending_seller_approval" | "admin" | "owner";

async function state(api: APIRequestContext): Promise<State> {
  const response = await api.get("/api/testing/alpha-exchange-state", { headers: supportHeaders });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<State>;
}

async function provision(api: APIRequestContext, role: Role, verified: boolean, email?: string, accountId?: string, adultConfirmed = true) {
  const db = await state(api);
  const template = db.users.find(user => user.email === process.env.E2E_BUYER_EMAIL);
  if (!template) throw new Error("The isolated verified buyer fixture is missing.");
  const id = accountId ?? "phone-gate-" + randomUUID();
  createdIds.add(id);
  const phone = "+972500019111";
  const { verifiedPhone: _phone, phoneVerifiedAt: _verifiedAt, ...base } = template;
  const user: User = {
    ...base,
    id,
    email: (email ?? id + "@example.test").toLowerCase(),
    fullName: "Phone Gate E2E",
    ageEligibility: adultConfirmed ? { method: "self_attestation_v1", confirmedAt: new Date().toISOString() } : undefined,
    role,
    roles: role === "guest" || role === "buyer" ? [role] : [role, "buyer"],
    sellerStatus: role === "approved_seller" ? "approved_seller"
      : role === "pending_seller_approval" ? "pending_seller_approval" : "buyer",
    whatsappNumber: phone,
    ...(verified ? { verifiedPhone: phone, phoneVerifiedAt: new Date().toISOString() } : {}),
  };
  const existing = db.users.find(item => item.email.toLowerCase() === user.email);
  if (existing) displacedUsers.push(existing);
  db.users = db.users.filter(item => item.email.toLowerCase() !== user.email);
  db.users.push(user);
  const saved = await api.put("/api/testing/alpha-exchange-state", { headers: supportHeaders, data: db });
  expect(saved.ok()).toBeTruthy();
  return user;
}

async function login(page: Page, user: User) {
  const response = await page.request.post("/api/auth/login", {
    headers: { "x-forwarded-for": "198.51.100.91" },
    data: { email: user.email, password: process.env.E2E_BUYER_PASSWORD, rememberMe: true },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const me = await page.request.get("/api/auth/me");
  expect(me.ok()).toBeTruthy();
  return (await me.json()).user as { isPhotoVerified: boolean; phoneVerificationExempt: boolean };
}

async function expectPhoneDenied(api: APIRequestContext) {
  for (const path of ["/api/alpha-exchange/listings", "/api/alpha-exchange/marketplace-pulse", "/api/alpha-exchange/purchase-requests"]) {
    const response = await api.get(path);
    expect(response.status(), path).toBe(403);
    expect(await response.json()).toMatchObject({ code: "PHONE_VERIFICATION_REQUIRED" });
  }
  const purchase = await api.post("/api/alpha-exchange/purchase-requests", { data: {} });
  expect(purchase.status()).toBe(403);
  expect(await purchase.json()).toMatchObject({ code: "PHONE_VERIFICATION_REQUIRED" });
}

async function expectMarketplaceVisible(page: Page) {
  const listings = await page.request.get("/api/alpha-exchange/listings");
  expect(listings.ok()).toBeTruthy();
  await page.goto("/en/usdt-exchange");
  await expect(page.getByRole("button", { name: /^Buy USDT from/ }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/en\/usdt-exchange$/);
}

test.afterAll(async () => {
  const api = await request.newContext({ baseURL: E2E_BASE_URL });
  const db = await state(api);
  db.users = [...db.users.filter(user => !createdIds.has(user.id)), ...displacedUsers];
  const response = await api.put("/api/testing/alpha-exchange-state", { headers: supportHeaders, data: db });
  expect(response.ok()).toBeTruthy();
  await api.dispose();
});

for (const role of ["buyer", "approved_seller", "pending_seller_approval", "admin", "owner"] as const) {
  test("unverified " + role + " cannot use exchange pages or APIs", async ({ page }) => {
    const user = await provision(page.request, role, false);
    expect(await login(page, user)).toMatchObject({ isPhotoVerified: false, phoneVerificationExempt: false });
    await expectPhoneDenied(page.request);
    const destination = role === "approved_seller" ? "/en/dashboard/seller"
      : role === "admin" || role === "owner" ? "/en/admin/alpha-exchange" : "/en/usdt-exchange";
    await page.goto(destination);
    await expect(page).toHaveURL(new RegExp("/en/verify-account\\?redirectTo=" + encodeURIComponent(destination) + "$"));
    // Recovery remains reachable even when mandatory verification is on.
    await page.goto("/en/verify-account");
    await expect(page).toHaveURL(/\/en\/verify-account$/);
  });
}

for (const email of ["Alphatradersai@gmail.com", "Claudiahttps11@gmail.com", "Jozenmark834@yahoo.com"]) {
  test("an authorized email alone cannot bypass verification " + email, async ({ page }) => {
    const user = await provision(page.request, "buyer", false, email);
    expect(await login(page, user)).toMatchObject({ isPhotoVerified: false, phoneVerificationExempt: false });
    await expectPhoneDenied(page.request);
    await page.goto("/en/usdt-exchange");
    await expect(page).toHaveURL(/\/en\/verify-account\?redirectTo=%2Fen%2Fusdt-exchange$/);
  });
}

for (const [id, email, role] of [
  ["user-030c4619-e1a6-4147-9d91-a8bbd2e2db4a", "alphatradersai@gmail.com", "buyer"],
  ["user-6f3a0120-5d36-423f-8dee-9a875e8e064e", "claudiahttps11@gmail.com", "approved_seller"],
  ["user-cfa3bd2c-25e7-4a9e-9ae5-55ac4900846f", "jozenmark834@yahoo.com", "owner"],
] as const) {
  test("exact authorized account can use exchange without phone verification " + email, async ({ page }) => {
    const user = await provision(page.request, role, false, email, id);
    expect(await login(page, user)).toMatchObject({ isPhotoVerified: true, phoneVerificationExempt: true });
    await expectMarketplaceVisible(page);
    // Use the confirmed browser sign-out before creating another session.
    // Replacing cookies through the API while the old page is still running
    // races its session-expiry redirect with the next marketplace navigation.
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/en$/);
    expect(await (await page.request.get("/api/auth/me")).json()).toEqual({ user: null });
    expect(await login(page, user)).toMatchObject({ isPhotoVerified: true, phoneVerificationExempt: true });
    await expectMarketplaceVisible(page);
    await page.goto("/ar/usdt-exchange");
    await expect(page).toHaveURL(/\/ar\/usdt-exchange$/);
    await page.getByRole("button", { name: "تسجيل الخروج", exact: true }).click();
    await expect(page).toHaveURL(/\/en$/);
    expect(await (await page.request.get("/api/auth/me")).json()).toEqual({ user: null });
    const saved = (await state(page.request)).users.find(item => item.id === id);
    expect(saved?.verifiedPhone).toBeUndefined();
    expect(saved?.phoneVerifiedAt).toBeUndefined();
  });
}

for (const role of ["buyer", "approved_seller"] as const) {
  test("a genuinely verified " + role + " can enter the exchange", async ({ page }) => {
    const user = await provision(page.request, role, true);
    expect(await login(page, user)).toMatchObject({ isPhotoVerified: true, phoneVerificationExempt: false });
    await expectMarketplaceVisible(page);
  });
}

test("a Guest becomes Buyer immediately after successful SMS verification", async ({ page }) => {
  const user = await provision(page.request, "guest", false);
  const db = await state(page.request);
  const stored = db.users.find(item => item.id === user.id)!;
  const phone = "+972500019333";
  const code = "621903";
  const salt = "isolated-phone-gate-test";
  Object.assign(stored, {
    onboardingSelection: "guest", onboardingCompletedAt: undefined,
    phoneOtpPhone: phone, phoneOtpChannel: "sms", phoneOtpSalt: salt,
    phoneOtpHash: createHash("sha256").update(`${phone}:${code}:${salt}`).digest("hex"),
    phoneOtpExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), phoneOtpAttempts: 0,
  });
  expect((await page.request.put("/api/testing/alpha-exchange-state", { headers: supportHeaders, data: db })).ok()).toBeTruthy();
  await login(page, user);
  const endpoint = "/api/alpha-exchange/phone/verify-code";
  expect((await page.request.post(endpoint, { data: { phone, code: "000000" } })).status()).toBe(400);
  expect((await (await page.request.get("/api/auth/me")).json()).user).toMatchObject({ role: "guest", roles: ["guest"] });
  expect((await page.request.post(endpoint, { data: { phone, code } })).ok()).toBeTruthy();
  expect((await (await page.request.get("/api/auth/me")).json()).user).toMatchObject({ role: "buyer", roles: ["buyer"], isPhotoVerified: true });
  const saved = (await state(page.request)).users.find(item => item.id === user.id);
  expect(saved).toMatchObject({ role: "buyer", roles: ["buyer"], verifiedPhone: phone, buyerVerificationStatus: "verified", onboardingSelection: "buyer" });
  await page.goto("/en/dashboard");
  await expect(page).toHaveURL(/\/en\/dashboard$/);
});

test("changing a verified number revokes exchange access after refresh", async ({ page }) => {
  const user = await provision(page.request, "buyer", true);
  await login(page, user);
  await expectMarketplaceVisible(page);
  const changed = await page.request.patch("/api/auth/profile", { data: { whatsappNumber: "+972500019112" } });
  expect(changed.ok(), await changed.text()).toBeTruthy();
  await expectPhoneDenied(page.request);
  await page.reload();
  await expect(page).toHaveURL(/\/en\/verify-account\?redirectTo=%2Fen%2Fusdt-exchange$/);
});
