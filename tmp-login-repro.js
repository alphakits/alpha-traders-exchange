const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:3001/en/login');
  console.log('URL', page.url());
  await page.fill('input[placeholder="Email"]', 'marksally11@yahoo.com');
  await page.fill('input[placeholder="Password"]', 'Roflxd123!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(8000);
  console.log('AFTER LOGIN', page.url());
  console.log((await page.textContent('body')).slice(0, 2000));
  await browser.close();
})();
