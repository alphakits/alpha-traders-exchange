import { randomUUID } from "node:crypto";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "./support/base-url";

const supportHeaders = { "x-alpha-test-support": "enabled" };
const createdIds = new Set<string>();
const displacedUsers: User[] = [];
type User = Record<string, unknown> & { id: string; email: string };
type State = Record<string, unknown> & { users: User[] };
type Role = "buyer" | "approved_seller" | "pending_seller_approval" | "admin" | "owner";

async function state(api: APIRequestContext): Promise<State> {
  const response = await api.get("/api/testing/alpha-exchange-state", { headers: supportHeaders });
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<State>;
}

async function provision(api: APIRequestContext, role: Role, verified: boolean, email?: string) {
  const db = await state(api);
  const template = db.users.find(user => user.email === process.env.E2E_BUYER_EMAIL);
  if (!template) throw new Error("The isolated verified buyer fixture is missing.");
  const id = "phone-gate-" + randomUUID();
  createdIds.add(id);
  const phone = "+972500019111";
  const { verifiedPhone: _phone, phoneVerifiedAt: _verifiedAt, ...base } = template;
  const user: User = {
    ...base,
    id,
    email: (email ?? id + "@example.test").toLowerCase(),
    fullName: "Phone Gate E2E",
    role,
    roles: role === "buyer" ? ["buyer"] : [role, "buyer"],
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
  test("previously exempt account must verify " + email, async ({ page }) => {
    const user = await provision(page.request, "buyer", false, email);
    expect(await login(page, user)).toMatchObject({ isPhotoVerified: false, phoneVerificationExempt: false });
    await expectPhoneDenied(page.request);
    await page.goto("/en/usdt-exchange");
    await expect(page).toHaveURL(/\/en\/verify-account\?redirectTo=%2Fen%2Fusdt-exchange$/);
  });
}

for (const role of ["buyer", "approved_seller"] as const) {
  test("a genuinely verified " + role + " can enter the exchange", async ({ page }) => {
    const user = await provision(page.request, role, true);
    expect(await login(page, user)).toMatchObject({ isPhotoVerified: true, phoneVerificationExempt: false });
    await expectMarketplaceVisible(page);
  });
}

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
