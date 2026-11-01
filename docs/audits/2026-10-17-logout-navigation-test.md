# Logout browser test navigation ordering

CI #1038 failed its strict WebKit gate because `e2e/auth.spec.ts` passed the logout case only on retry. The test posted to the logout API outside the page and immediately navigated to Academy. The still-mounted marketplace page concurrently reacted to the revoked session and redirected to login with the marketplace destination, interrupting the test's navigation.

The four English/Arabic phone/desktop commission receiving-amount cases passed on their first attempt. Their screenshots and the original logout failure trace are retained. A flaky run is not release acceptance.

The corrected test exercises the visible **Sign out** control, asserts that its API request succeeds, waits for the completed public-home navigation, verifies that the sign-out control disappears and `/api/auth/me` returns 401, then opens Academy and requires the exact preserved login destination. There are no swallowed navigation errors, arbitrary sleeps, relaxed destinations or disabled checks.

The WebKit release job additionally repeats this corrected user journey three times with retries disabled. The existing strict no-flaky gate remains unchanged. Application authentication and commission settlement code are unchanged by this test correction.

Local browser execution remains blocked by missing Chromium/WebKit runtime dependencies; the hosted gate supplies the authoritative rerun evidence. Focused lint and TypeScript checks validate the test edit locally.
