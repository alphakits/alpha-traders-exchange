/**
 * Production security boundaries must not depend on a mutable feature flag.
 *
 * Local Playwright starts a production Next server to exercise the real build.
 * It opts in with two dedicated markers and binds its server to loopback. A
 * Vercel deployment is never treated as that local test runtime, even if an
 * unsafe variable is configured there.
 */
export function isExplicitLocalProductionE2eRuntime() {
  return process.env.NODE_ENV === "production"
    && process.env.ALPHA_E2E_TEST_SUPPORT === "1"
    && process.env.ALPHA_E2E_LOOPBACK_ONLY === "1"
    && !process.env.VERCEL
    && !process.env.VERCEL_ENV;
}

export function isProductionSecurityRuntime() {
  return process.env.NODE_ENV === "production" && !isExplicitLocalProductionE2eRuntime();
}

export function allowsTestOnlyRuntime() {
  return process.env.NODE_ENV !== "production" || isExplicitLocalProductionE2eRuntime();
}

/**
 * Test-support routes expose mutable fixtures and must never be reachable from
 * a deployed host. The explicit marker is necessary but not sufficient: the
 * request itself must target the loopback server started by Playwright.
 */
export function allowsLocalTestSupportRequest(request: { nextUrl: URL }) {
  if (!allowsTestOnlyRuntime()) return false;

  const hostname = request.nextUrl.hostname.trim().toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function allowsRuntimeDiagnostics() {
  return !isProductionSecurityRuntime();
}
