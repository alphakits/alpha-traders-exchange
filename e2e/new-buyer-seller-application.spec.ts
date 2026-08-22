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
const REJECTED_BUYER = {
  id: "e2e-rejected-buyer-seller-application",
  email: "e2e-rejected-buyer-seller-application@example.test",
  password: "RejectedBuyer!SellerApplication2026",
  phone: "+972500000078",
};
const ORPHANED_APPLICANT = {
  id: "e2e-orphaned-seller-applicant",
  email: "e2e-orphaned-seller-applicant@example.test",
  password: "OrphanedSellerApplicant2026",
  phone: "+972500000079",
};
const ADMIN = {
  email: "e2e-global-admin@example.test",
  password: "E2eAdmin!Launch2026",
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

async function login(api: APIRequestContext, account = BUYER) {
  const response = await api.post("/api/auth/login", {
    headers: { "x-forwarded-for": "198.51.100.77" },
    data: { email: account.email, password: account.password, rememberMe: true },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function addBuyer(db: AlphaExchangeDb, account: typeof BUYER, now: string) {
  db.users.push({
    id: account.id,
    fullName: "New Buyer Seller Applicant",
    email: account.email,
    passwordHash: await hashPassword(account.password),
    whatsappNumber: account.phone,
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
    buyerVerificationStatus: "not_started",
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
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const api = await request.newContext({ baseURL: E2E_BASE_URL });
  const db = await readState(api);
  originalSnapshot = JSON.parse(JSON.stringify(db)) as AlphaExchangeDb;
  const now = new Date().toISOString();
  db.users = db.users.filter((user) => ![BUYER.id, REJECTED_BUYER.id, ORPHANED_APPLICANT.id].includes(user.id) && ![BUYER.email, REJECTED_BUYER.email, ORPHANED_APPLICANT.email].includes(user.email));
  db.sellerApplications = db.sellerApplications.filter((application) => ![BUYER.id, REJECTED_BUYER.id, ORPHANED_APPLICANT.id].includes(application.userId));
  await addBuyer(db, BUYER, now);
  await addBuyer(db, REJECTED_BUYER, now);
  await addBuyer(db, ORPHANED_APPLICANT, now);
  const orphanIndex = db.users.findIndex((user) => user.id === ORPHANED_APPLICANT.id);
  db.users[orphanIndex] = {
    ...db.users[orphanIndex],
    role: "pending_seller_approval",
    roles: ["pending_seller_approval"],
    sellerStatus: "pending_seller_approval",
    onboardingSelection: "seller_applicant",
    onboardingCompletedAt: now,
  };
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

test("a strict orphaned legacy seller applicant can reapply without gaining seller privileges", async ({ page }) => {
  await login(page.request, ORPHANED_APPLICANT);
  await page.goto("/en/usdt-exchange");
  const main = page.getByRole("main");
  await expect(main.getByText("Become an Approved Seller")).toBeVisible({ timeout: 30_000 });
  const openApplication = main.locator("#seller-application button").filter({ hasText: "Open Seller Application" });
  if (await openApplication.isVisible().catch(() => false)) await openApplication.click();
  await expect(page.locator("#seller-first-name")).toBeVisible({ timeout: 30_000 });
  await page.locator("#seller-first-name").fill("Orphaned");
  await page.locator("#seller-last-name").fill("Applicant");
  await page.locator("#seller-whatsapp").fill(ORPHANED_APPLICANT.phone);
  await page.getByText("Apply for Approval", { exact: true }).click();
  await expect(page.getByText("Application Pending Review")).toBeVisible({ timeout: 30_000 });

  const authState = await page.request.get("/api/auth/me");
  expect(authState.ok()).toBeTruthy();
  const payload = await authState.json() as { user?: { sellerStatus?: string; roles?: string[] } };
  expect(payload.user?.sellerStatus).toBe("pending_seller_approval");
  expect(payload.user?.roles).toEqual(expect.arrayContaining(["buyer", "pending_seller_approval"]));
  expect(payload.user?.roles).not.toContain("approved_seller");
});

test("buyer without phone verification can submit and retain a pending seller application", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page.request);
  await page.goto("/en/usdt-exchange");
  const main = page.getByRole("main");
  await expect(main.getByText("Become an Approved Seller")).toBeVisible({ timeout: 30_000 });
  const openApplication = main.locator("#seller-application button").filter({ hasText: "Open Seller Application" });
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

  const duplicate = await page.request.post("/api/alpha-exchange/seller-application", {
    data: {
      fullName: "New Buyer",
      whatsappNumber: BUYER.phone,
      preferredNetworks: ["Bank Transfer"],
    },
  });
  expect(duplicate.status()).toBe(400);
  await expect(duplicate.json()).resolves.toMatchObject({ error: "Your seller application is already pending review." });

  await page.reload();
  await expect(page.getByText("Application Pending Review")).toBeVisible({ timeout: 30_000 });
  await page.request.post("/api/auth/logout");
  await login(page.request);
  await page.goto("/en/usdt-exchange");
  await expect(page.getByText("Application Pending Review")).toBeVisible({ timeout: 30_000 });
});

test("manual admin approval is required before the applicant becomes a seller", async () => {
  const buyerApi = await request.newContext({ baseURL: E2E_BASE_URL });
  const state = await readState(buyerApi);
  const application = state.sellerApplications.find((item) => item.userId === BUYER.id);
  expect(application?.status).toBe("pending");
  await buyerApi.dispose();

  const adminApi = await request.newContext({ baseURL: E2E_BASE_URL });
  await login(adminApi, ADMIN);
  const approval = await adminApi.post(`/api/alpha-exchange/admin/seller-applications/${encodeURIComponent(application!.id)}/approve`, {
    data: { reason: "E2E manual approval" },
  });
  expect(approval.ok(), await approval.text()).toBeTruthy();
  await adminApi.dispose();

  const verifyApi = await request.newContext({ baseURL: E2E_BASE_URL });
  const approvedState = await readState(verifyApi);
  const approvedUser = approvedState.users.find((user) => user.id === BUYER.id);
  const approvedApplication = approvedState.sellerApplications.find((item) => item.userId === BUYER.id);
  expect(approvedApplication?.status).toBe("approved");
  expect(approvedUser?.sellerStatus).toBe("approved_seller");
  expect(approvedUser?.roles).toEqual(expect.arrayContaining(["buyer", "approved_seller"]));
  expect(approvedUser?.roles).not.toContain("pending_seller_approval");
  await verifyApi.dispose();
});

test("manual rejection leaves the applicant a buyer and permits a later resubmission", async () => {
  const applicantApi = await request.newContext({ baseURL: E2E_BASE_URL });
  await login(applicantApi, REJECTED_BUYER);
  const applicationResponse = await applicantApi.post("/api/alpha-exchange/seller-application", {
    data: {
      fullName: "Rejected Buyer",
      whatsappNumber: REJECTED_BUYER.phone,
      preferredNetworks: ["Bank Transfer"],
    },
  });
  expect(applicationResponse.ok(), await applicationResponse.text()).toBeTruthy();
  const { application } = await applicationResponse.json() as { application: { id: string } };
  await applicantApi.dispose();

  const adminApi = await request.newContext({ baseURL: E2E_BASE_URL });
  await login(adminApi, ADMIN);
  const rejection = await adminApi.post(`/api/alpha-exchange/admin/seller-applications/${encodeURIComponent(application.id)}/reject`, {
    data: { reason: "E2E manual rejection" },
  });
  expect(rejection.ok(), await rejection.text()).toBeTruthy();
  await adminApi.dispose();

  const verifyApi = await request.newContext({ baseURL: E2E_BASE_URL });
  const rejectedState = await readState(verifyApi);
  const rejectedUser = rejectedState.users.find((user) => user.id === REJECTED_BUYER.id);
  const rejectedApplication = rejectedState.sellerApplications.find((item) => item.userId === REJECTED_BUYER.id);
  expect(rejectedApplication?.status).toBe("rejected");
  expect(rejectedUser?.sellerStatus).toBe("rejected");
  expect(rejectedUser?.roles).toEqual(["buyer"]);
  await verifyApi.dispose();

  const resubmissionApi = await request.newContext({ baseURL: E2E_BASE_URL });
  await login(resubmissionApi, REJECTED_BUYER);
  const resubmission = await resubmissionApi.post("/api/alpha-exchange/seller-application", {
    data: {
      fullName: "Rejected Buyer",
      whatsappNumber: REJECTED_BUYER.phone,
      preferredNetworks: ["Bank Transfer"],
    },
  });
  expect(resubmission.status(), await resubmission.text()).toBe(201);
  await resubmissionApi.dispose();
});
