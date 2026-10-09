/** Local-only UX review: real listing requests; simulated commission display states. */
import { chromium, request as apiRequest, type Page, type Locator } from 'playwright';
import { expect } from '@playwright/test';
import { provisionQaWorld } from '../e2e/support/qa-accounts';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function main() {
  const baseURL = process.env.REVIEW_BASE_URL ?? 'http://127.0.0.1:3100';
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) throw Error('Review fixtures require a loopback server.');
  const out = resolve(process.env.REVIEW_OUTPUT_DIR ?? 'test-results/ux-review');
  await mkdir(out, { recursive: true });
  const api = await apiRequest.newContext({ baseURL });
  const world = await provisionQaWorld(api);
  const headers = { 'x-alpha-test-support': 'enabled' };
  const state = await (await api.get('/api/testing/alpha-exchange-state', { headers })).json();
  const buyer = { ...state.users.find((user: { id: string }) => user.id === world.seller.id), id: `review-buyer-${world.seller.id}`, email: `review-buyer-${world.seller.email}`, role: 'buyer', roles: ['buyer'], sellerStatus: 'buyer', sellerBankAccounts: [], sellerApprovalVerification: undefined, fullName: 'Review Buyer' };
  state.users.push(buyer);
  state.marketplaceListings = state.marketplaceListings.filter((listing: { id: string }) => listing.id === world.listingId);
  expect((await api.put('/api/testing/alpha-exchange-state', { headers, data: state })).ok()).toBe(true);
  const browser = await chromium.launch({ executablePath: process.env.REVIEW_CHROMIUM_PATH, args: JSON.parse(process.env.REVIEW_CHROMIUM_ARGS ?? '[]'), headless: true });
  // This local Next dev uses eval for source maps. Production CSP is unchanged.
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', bypassCSP: true });
  expect((await context.request.post('/api/auth/login', { data: { email: world.seller.email, password: world.seller.password, rememberMe: false } })).ok()).toBe(true);
  context.setDefaultTimeout(30000);
  const page = await context.newPage();
  process.on('unhandledRejection', async () => { await page.screenshot({path: `${out}/failure.png`, fullPage: true}); });
  const pageErrors: string[] = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  const evidence: Record<string, unknown>[] = [];
  async function shot(name: string, element: Locator = page.locator('main').first()) {
    await element.scrollIntoViewIfNeeded();
    await element.screenshot({ path: `${out}/${name}.png`, animations: 'disabled', style: 'nav[aria-label="Mobile primary navigation"], nav[aria-label="التنقل الرئيسي للهاتف"], nextjs-portal { visibility: hidden !important; }' });
    await writeFile(`${out}/${name}.txt`, await element.innerText());
    console.log('CAPTURED', name);
  }
  async function noOverflow(target: Page, label: string) {
    for (const width of [320, 390, 1440]) {
      await target.setViewportSize({ width, height: 900 });
      const overflow = await target.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${label} at ${width}px`).toBeLessThanOrEqual(1);
    }
    await target.setViewportSize({ width: 390, height: 844 });
  }
  for (const locale of (process.argv[2] === 'buyer' ? [] : ['en', 'ar']) as ('en' | 'ar')[]) {
    await page.goto(`/${locale}/dashboard/seller`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const form = page.locator('#create-listing');
    await expect(form.locator('#create-amount-heading')).toBeVisible({ timeout: 60000 });
    const continueButton = form.getByRole('button', { name: locale === 'en' ? 'Continue to payment' : 'متابعة إلى الدفع' });
    await expect(continueButton).toBeDisabled();
    await form.locator('#create-available').fill('1000');
    await form.locator('#create-price').fill('3.10');
    await form.locator('#create-min-trade').fill('100');
    await form.locator('#create-max-trade').fill('1000');
    await expect(continueButton).toBeEnabled();
    await noOverflow(page, `${locale} amount`);
    await shot(`after-listing-amount-${locale}`, form);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await shot(`after-listing-desktop-${locale}`, form);
    await page.setViewportSize({ width: 390, height: 844 });
    await continueButton.click();
    await expect(form.locator('#create-payment-heading')).toBeFocused();
    await form.locator('#create-bank-account').selectOption(`bank-${world.seller.id}`);
    const reviewButton = form.getByRole('button', { name: locale === 'en' ? 'Review listing' : 'مراجعة العرض' });
    await expect(reviewButton).toBeEnabled();
    await noOverflow(page, `${locale} payment`);
    await shot(`after-listing-payment-${locale}`, form);
    await form.getByRole('button', { name: locale === 'en' ? 'Back' : 'رجوع', exact: true }).click();
    await expect(form.locator('#create-available')).toHaveValue('1,000');
    await continueButton.click();
    await reviewButton.click();
    await expect(form.locator('#create-review-heading')).toBeFocused();
    const submit = form.getByRole('button', { name: locale === 'en' ? 'Submit Listing' : 'إرسال العرض', exact: true });
    await expect(submit).toBeDisabled();
    const agreement = form.getByRole('checkbox');
    await agreement.check();
    await expect(submit).toBeEnabled();
    await noOverflow(page, `${locale} review`);
    await shot(`after-listing-review-${locale}`, form);
    await shot(`after-manage-${locale}`, page.locator('#my-listings-section'));
    await shot(`after-commission-${locale}`, page.locator('#commission-status'));
    if (locale === 'ar') {
      const pending = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/alpha-exchange/listings');
      await submit.click();
      const response = await pending;
      expect([200, 201]).toContain(response.status());
      const payload = await response.json();
      expect(payload.listing).toMatchObject({ status: 'draft', approvalStatus: 'pending', availableAmount: '1000' });
      const saved = await (await context.request.get('/api/alpha-exchange/my-listings')).json();
      expect(saved.listings.some((listing: { id: string }) => listing.id === payload.listing.id)).toBe(true);
      await expect(page.locator(`#seller-listing-${payload.listing.id}`)).toBeVisible({ timeout: 30000 });
      evidence.push({ story: 'Listing wizard → POST → saved pending listing → management row', locale, status: response.status(), passed: true });
      await shot('after-listing-submitted-ar', form);
    }
    evidence.push({ story: 'Required fields, back preserves values, focus moves, fee consent, no overflow at 320/390/1440', locale, passed: true });
  }
  const ready = { status: 'ready', checkout: null, walletAddress: null, pendingCount: 1, totalDueUsdt: 40 };
  const waiting = { ...ready, status: 'waiting', walletAddress: '0x7088a120cde7351dbf3e7831a9da3f74058c89a0', checkout: { id: 'review-only', sellerId: world.seller.id, network: 'BEP20', expectedMicros: 40_250_000, dueMicros: 40_000_000 } };
  for (const locale of (process.argv[2] === 'buyer' ? [] : ['en', 'ar'])) {
    for (const payment of [ready, waiting]) {
      await page.route('**/api/alpha-exchange/commissions/checkout', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(payment) }));
      await page.goto(`/${locale}/seller/commission-checkout`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await expect(page.getByRole('heading', { name: locale === 'en' ? 'Pay commission' : 'دفع العمولة', exact: true })).toBeVisible();
      if (payment.status === 'ready') await expect(page.locator('.commission-surface input[type=checkbox]')).toBeVisible();
      else await expect(page.locator('.commission-surface').getByRole('button', {name: locale === 'en' ? 'Copy exact amount' : 'نسخ المبلغ كاملًا'})).toBeVisible();
      await noOverflow(page, `${locale} commission ${payment.status}`);
      await shot(`after-checkout-${payment.status}-${locale}`, page.locator('.commission-surface'));
      await page.unroute('**/api/alpha-exchange/commissions/checkout');
    }
    await page.goto(`/${locale}/help-center`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await noOverflow(page, `${locale} help`);
    await shot(`after-help-${locale}`);
  }
  if (process.argv[2] === 'buyer') {
    expect((await context.request.post('/api/auth/login', { data: { email: buyer.email, password: world.seller.password, rememberMe: false } })).ok()).toBe(true);
    await page.goto('/en/usdt-exchange?mode=buy', { waitUntil: 'domcontentloaded', timeout: 120000 });
    const listing = page.locator(`#listing-${world.listingId}`);
    await expect(listing).toBeVisible({timeout: 60000});
    await listing.getByRole('button', {name: /Buy USDT from/}).click();
    const dialog = page.getByRole('dialog', {name: 'Buy USDT', exact: true});
    await dialog.locator('#buyer-usdt-amount').fill('125');
    await dialog.locator('#buyer-receiving-wallet').fill('TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE');
    if (await dialog.getByRole('checkbox').count()) await dialog.getByRole('checkbox').check();
    await expect(dialog.getByRole('button', {name: 'Quick Buy'})).toHaveCount(0);
    await expect(dialog.getByRole('button', {name: 'Start Trade', exact: true})).toBeEnabled();
    await noOverflow(page, 'Buyer request');
    await dialog.locator('.overflow-y-auto').evaluate(element => { element.scrollTop = 0; });
    await shot('after-buy-en', dialog);
    const created = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/alpha-exchange/purchase-requests');
    await dialog.getByRole('button', {name: 'Start Trade', exact: true}).click();
    const response = await created;
    expect(response.ok(), await response.text()).toBe(true);
    const payload = await response.json();
    const purchase = payload.purchase ?? payload.request;
    expect(purchase.id).toBeTruthy();
    expect((await api.post('/api/auth/login', { data: { email: world.seller.email, password: world.seller.password, rememberMe: false } })).ok()).toBe(true);
    const accepted = await api.patch(`/api/alpha-exchange/purchase-requests/${purchase.id}`, {data: {status: 'accepted'}});
    expect(accepted.ok(), await accepted.text()).toBe(true);
    await page.goto(`/en/trade-room/${purchase.id}`, {waitUntil: 'domcontentloaded', timeout: 120000});
    await expect(page.getByTestId('trade-room-summary')).toBeVisible({ timeout: 45000 });
    await noOverflow(page, 'Trade room');
    await shot('after-trade-en');
    evidence.push({story: 'Single buyer action → request API → seller accepts → trade room', passed: true, status: response.status()});
    // An accepted trade intentionally keeps this buyer in the Trade Room.
    // Close that page before opening a separate signed-out login preview.
    await page.close();
    await context.clearCookies();
    const loginPage = await context.newPage();
    await loginPage.goto('/en/login', {waitUntil: 'domcontentloaded', timeout: 120000});
    await expect(loginPage.getByRole('button', {name: 'Login', exact: true})).toBeVisible();
    await shot('after-login-en', loginPage.locator('main').first());
  }
  await writeFile(`${out}/${process.argv[2] === "buyer" ? "buyer-verification" : "verification"}.json`, JSON.stringify({ evidence, pageErrors, paymentScreens: 'Simulated display states; no payment sent or blockchain verification claimed.' }, null, 2));
  expect(pageErrors).toEqual([]);
  await browser.close(); await api.dispose();
}
main().catch(error => { console.error(error); process.exit(1); });
