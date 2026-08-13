import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { expect, request, test, type APIRequestContext } from "@playwright/test";
import type { AlphaExchangeDb } from "@/types/alpha-exchange";
import { E2E_BASE_URL } from "./support/base-url";

const scrypt = promisify(scryptCallback);
const SUPPORT_HEADERS = { "content-type": "application/json", "x-alpha-test-support": "enabled" };
const BUYER = {
  id: "e2e-new-buyer-seller-application",
  email: "e2e-new-buyer-seller-application@example.test",
  password: "NewBuyer!SellerApplication2026",
  phone: "+972500000077",
};

let originalSnapshot: AlphaExchangeDb | null = null;

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function readState(api: APIRequestContext) {
  const response = await api.get("/api/testing/alpha-exchange-state", { headers: SUPPORT_HEADERS });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as AlphaExchangeDb;
}

async function writeState(api: APIRequestContext, db: AlphaExchangeDb) {
  const response = await api.put("/api/testing/alpha-exchange-state", { headers: SUPPORT_HEADERS, data: db });
  expect(response.ok()).toBeTruthy();
}

async function login(api: APIRequestContext) {
  const response = await api.post("/api/auth/login", {
    headers: { "x-forwarded-for": "198.51.100.77" },
    data: { email: BUYER.email, password: BUYER.password, rememberMe: true },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const api = await request.newContext({ baseURL: E2E_BASE_URL });
  const db = await readState(api);
  originalSnapshot = JSON.parse(JSON.stringify(db)) as AlphaExchangeDb;
  const now = new Date().toISOString();
  db.users = db.users.filter((user) => user.id !== BUYER.id && user.email !== BUYER.email);
  db.sellerApplications = db.sellerApplications.filter((application) => application.userId !== BUYER.id);
  db.users.push({
    id: BUYER.id,
    fullName: "New Buyer Seller Applicant",
    email: BUYER.email,
    passwordHash: await hashPassword(BUYER.password),
    whatsappNumber: BUYER.phone,
    role: "buyer",
    roles: ["buyer"],
    sellerStatus: "buyer",
    preferredNetworks: [],
    preferredPaymentMethods: [],
    profilePhotoUrl: "",
    languages: ["English"],
    bio: "",
    tradingExperience: "",
    workingHours: "",
    country: "Israel",
    city: "",
    coverBannerUrl: "",
    notificationPreferences: { inApp: true, email: false, sms: false },
    emailVerified: true,
    emailVerifiedAt: now,
    verifiedPhone: BUYER.phone,
    phoneVerifiedAt: now,
    buyerVerificationStatus: "verified",
    buyerFirstName: "New",
    buyerLastName: "Buyer",
    buyerDisplayName: "New Buyer Seller Applicant",
    onboardingSelection: "buyer",
    onboardingCompletedAt: now,
    onlineStatus: "online",
    availabilityStatus: "available",
    createdAt: now,
    updatedAt: now,
  } as AlphaExchangeDb["users"][number]);
  await writeState(api, db);
  await login(api);
  await api.dispose();
});

test.afterAll(async () => {
  if (!originalSnapshot) return;
  const api = await request.newContext({ baseURL: E2E_BASE_URL });
  await writeState(api, originalSnapshot);
  await api.dispose();
});

test("new buyer can open, submit, and retain pending seller application", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page.request);
  await page.goto("/en/usdt-exchange");
  await expect(page.getByText("Become an Approved Seller")).toBeVisible({ timeout: 30_000 });
  const openApplication = page.locator("#seller-application button").filter({ hasText: "Open Seller Application" });
  if (await openApplication.isVisible().catch(() => false)) await openApplication.click();
  const submitApplication = page.getByText("Apply for Approval", { exact: true });
  await expect(page.locator("#seller-first-name")).toBeVisible({ timeout: 30_000 });
  await page.locator("#seller-first-name").fill("New");
  await page.locator("#seller-last-name").fill("Buyer");
  await page.locator("#seller-whatsapp").fill(BUYER.phone);
  await expect(submitApplication).toBeVisible();

  const initialUrl = page.url();
  await submitApplication.click();
  await expect(page).toHaveURL(initialUrl);
  await expect(page.getByText("Application Pending Review")).toBeVisible({ timeout: 30_000 });

  const pendingState = await page.request.get("/api/auth/me");
  expect(pendingState.ok()).toBeTruthy();
  const payload = await pendingState.json() as { user?: { sellerStatus?: string; roles?: string[] } };
  expect(payload.user?.sellerStatus).toBe("pending_seller_approval");
  expect(payload.user?.roles).toContain("buyer");
  expect(payload.user?.roles).toContain("pending_seller_approval");

  await page.reload();
  await expect(page.getByText("Application Pending Review")).toBeVisible({ timeout: 30_000 });
  await page.request.post("/api/auth/logout");
  await login(page.request);
  await page.goto("/en/usdt-exchange");
  await expect(page.getByText("Application Pending Review")).toBeVisible({ timeout: 30_000 });
});