import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productionOrigin = "https://www.alphatraders.co.il";
const appVersion = JSON.parse(
  readFileSync(resolve(repositoryRoot, "apps/mobile/app.json"), "utf8"),
).expo.version;

export const REVIEW_HTML_CHECKS = [
  { path: "/en", label: "English public entry", markers: ["Alpha Traders"] },
  { path: "/ar", label: "Arabic public entry", markers: ["Alpha Traders"] },
  { path: "/en/login", label: "English reviewer login", markers: ["Login", "Alpha Exchange"] },
  { path: "/ar/login", label: "Arabic reviewer login", markers: ["تسجيل الدخول", "Alpha Exchange"] },
  { path: "/en/register", label: "English registration", markers: ["Register", "Create Account"] },
  { path: "/ar/register", label: "Arabic registration", markers: ["إنشاء حساب"] },
  { path: "/en/privacy-policy", label: "English privacy policy", markers: ["Privacy Policy"] },
  { path: "/ar/privacy-policy", label: "Arabic privacy policy", markers: ["سياسة الخصوصية"] },
  { path: "/en/terms", label: "English terms", markers: ["Terms of Service", "USDT"] },
  { path: "/ar/terms", label: "Arabic terms", markers: ["الشروط والأحكام", "USDT"] },
  {
    path: "/en/support",
    label: "English support",
    markers: [
      "Support",
      "mailto:support@alphatraders.co.il",
      'aria-label="Send us a message"',
    ],
  },
  {
    path: "/ar/support",
    label: "Arabic support",
    markers: [
      "الدعم",
      "mailto:support@alphatraders.co.il",
      'aria-label="أرسل لنا رسالة"',
    ],
  },
  { path: "/en/help-center", label: "English help center", markers: ["Help Center", "Trade Room"] },
  { path: "/ar/help-center", label: "Arabic help center", markers: ["مركز المساعدة", "USDT"] },
  { path: "/en/safety-trust", label: "English safety center", markers: ["Safety &amp; Trust Center", "USDT"] },
  { path: "/ar/safety-trust", label: "Arabic safety center", markers: ["مركز الأمان والثقة", "USDT"] },
  { path: "/en/report-abuse", label: "English abuse report", markers: ["Report Abuse", "Send us a message"] },
  { path: "/ar/report-abuse", label: "Arabic abuse report", markers: ["الإبلاغ عن إساءة", "أرسل لنا رسالة"] },
  { path: "/en/account-deletion", label: "English account deletion", markers: ["Request account deletion", "Send us a message"] },
  { path: "/ar/account-deletion", label: "Arabic account deletion", markers: ["طلب حذف الحساب", "أرسل لنا رسالة"] },
];

function reviewFailure(message) {
  const error = new Error(message);
  error.name = "MobileReviewSurfaceError";
  return error;
}

function normalizePath(pathname) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

export function normalizeReviewBaseUrl(rawValue) {
  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw reviewFailure(`Invalid review base URL: ${rawValue}`);
  }

  const isLoopback = parsed.hostname === "localhost"
    || parsed.hostname === "127.0.0.1"
    || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
    throw reviewFailure("The review base URL must use HTTPS; HTTP is permitted only for a loopback test server.");
  }
  if (parsed.username || parsed.password) {
    throw reviewFailure("The review base URL must not contain credentials.");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw reviewFailure("The review base URL must be an origin without a path, query, or fragment.");
  }
  return parsed.origin;
}

function parsePositiveInteger(rawValue, label) {
  if (!/^\d+$/.test(rawValue)) throw reviewFailure(`${label} must be a positive integer.`);
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 250 || value > 60_000) {
    throw reviewFailure(`${label} must be between 250 and 60000 milliseconds.`);
  }
  return value;
}

export function parseReviewSurfaceArguments(argumentsList, environment = process.env) {
  let baseUrl = environment.ALPHA_REVIEW_BASE_URL?.trim() || productionOrigin;
  let timeoutMs = 12_000;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--base-url") {
      const value = argumentsList[index + 1];
      if (!value) throw reviewFailure("--base-url requires a value.");
      baseUrl = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--base-url=")) {
      baseUrl = argument.slice("--base-url=".length);
      continue;
    }
    if (argument === "--timeout-ms") {
      const value = argumentsList[index + 1];
      if (!value) throw reviewFailure("--timeout-ms requires a value.");
      timeoutMs = parsePositiveInteger(value, "--timeout-ms");
      index += 1;
      continue;
    }
    if (argument.startsWith("--timeout-ms=")) {
      timeoutMs = parsePositiveInteger(argument.slice("--timeout-ms=".length), "--timeout-ms");
      continue;
    }
    throw reviewFailure(`Unknown review-surface argument: ${argument}`);
  }

  return { baseUrl: normalizeReviewBaseUrl(baseUrl), timeoutMs };
}

async function fetchWithDeadline(fetchImplementation, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImplementation(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw reviewFailure(`Timed out after ${timeoutMs}ms: ${url}`);
    const detail = error instanceof Error ? error.message : String(error);
    throw reviewFailure(`Could not reach ${url}: ${detail}`);
  } finally {
    clearTimeout(timeout);
  }
}

function assertExpectedDestination(response, requestedUrl, baseUrl, expectedPath) {
  if (!response.url) return;
  const finalUrl = new URL(response.url);
  if (finalUrl.origin !== baseUrl || normalizePath(finalUrl.pathname) !== normalizePath(expectedPath)) {
    throw reviewFailure(`${requestedUrl} redirected to an unexpected destination: ${response.url}`);
  }
}

async function checkHtmlPage({ fetchImplementation, baseUrl, timeoutMs, check }) {
  const requestedUrl = `${baseUrl}${check.path}`;
  const response = await fetchWithDeadline(fetchImplementation, requestedUrl, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Alpha-Traders-App-Review-Preflight/1.0",
    },
  }, timeoutMs);
  assertExpectedDestination(response, requestedUrl, baseUrl, check.path);
  if (response.status !== 200) {
    throw reviewFailure(`${check.label} returned HTTP ${response.status}: ${requestedUrl}`);
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html")) {
    throw reviewFailure(`${check.label} did not return HTML: ${requestedUrl}`);
  }
  const html = await response.text();
  if (html.length < 200) throw reviewFailure(`${check.label} returned an unexpectedly empty page.`);
  for (const marker of check.markers) {
    if (!html.includes(marker)) {
      throw reviewFailure(`${check.label} is missing its required review marker: ${marker}`);
    }
  }
  return { label: check.label, url: requestedUrl };
}

async function checkHealth({ fetchImplementation, baseUrl, timeoutMs }) {
  const path = "/api/health";
  const requestedUrl = `${baseUrl}${path}`;
  const response = await fetchWithDeadline(fetchImplementation, requestedUrl, {
    redirect: "follow",
    headers: {
      Accept: "application/json",
      "User-Agent": "Alpha-Traders-App-Review-Preflight/1.0",
    },
  }, timeoutMs);
  assertExpectedDestination(response, requestedUrl, baseUrl, path);
  if (response.status !== 200) throw reviewFailure(`Production health returned HTTP ${response.status}.`);
  const payload = await response.json().catch(() => null);
  if (payload?.status !== "ok" || payload?.checks?.database !== "ok") {
    throw reviewFailure("Production health did not report both service and database status as ok.");
  }
  if (Number.isNaN(Date.parse(payload.timestamp ?? ""))) {
    throw reviewFailure("Production health did not return a valid timestamp.");
  }
  return { label: "Service and database health", url: requestedUrl };
}

async function checkMobileAppConfig({ fetchImplementation, baseUrl, timeoutMs, platform }) {
  const path = "/api/mobile/v1/app-config";
  const requestedUrl = `${baseUrl}${path}`;
  const response = await fetchWithDeadline(fetchImplementation, requestedUrl, {
    redirect: "follow",
    headers: {
      Accept: "application/json",
      "Accept-Language": "en",
      "X-Locale": "en",
      "X-App-Version": appVersion,
      "X-Device-Id": `alpha-review-preflight-${platform}-device`,
      "X-Platform": platform,
      "X-Request-Id": `review-preflight-${platform}`,
      "User-Agent": "Alpha-Traders-App-Review-Preflight/1.0",
    },
  }, timeoutMs);
  assertExpectedDestination(response, requestedUrl, baseUrl, path);
  if (response.status !== 200) {
    throw reviewFailure(`${platform} app configuration returned HTTP ${response.status}.`);
  }
  const payload = await response.json().catch(() => null);
  if (
    payload?.apiVersion !== "v1"
    || payload?.platform !== platform
    || payload?.currentVersion !== appVersion
    || typeof payload?.minimumSupportedVersion !== "string"
    || typeof payload?.latestVersion !== "string"
    || typeof payload?.updateRecommended !== "boolean"
    || typeof payload?.requestId !== "string"
    || Number.isNaN(Date.parse(payload?.checkedAt ?? ""))
  ) {
    throw reviewFailure(`${platform} app configuration did not match the submitted ${appVersion} client contract.`);
  }
  if (payload.updateRequired !== false) {
    throw reviewFailure(`${platform} app version ${appVersion} is blocked by the production minimum-version policy.`);
  }
  return { label: `${platform} app configuration`, url: requestedUrl };
}

export async function runReviewSurfaceChecks({
  baseUrl,
  timeoutMs = 12_000,
  fetchImplementation = globalThis.fetch,
  onPass = () => {},
}) {
  const normalizedBaseUrl = normalizeReviewBaseUrl(baseUrl);
  if (typeof fetchImplementation !== "function") throw reviewFailure("A Fetch API implementation is required.");

  const results = [];
  results.push(await checkHealth({ fetchImplementation, baseUrl: normalizedBaseUrl, timeoutMs }));
  results.push(await checkMobileAppConfig({
    fetchImplementation,
    baseUrl: normalizedBaseUrl,
    timeoutMs,
    platform: "ios",
  }));
  results.push(await checkMobileAppConfig({
    fetchImplementation,
    baseUrl: normalizedBaseUrl,
    timeoutMs,
    platform: "android",
  }));

  for (const check of REVIEW_HTML_CHECKS) {
    results.push(await checkHtmlPage({ fetchImplementation, baseUrl: normalizedBaseUrl, timeoutMs, check }));
  }
  for (const result of results) onPass(result);
  return results;
}

async function main() {
  const options = parseReviewSurfaceArguments(process.argv.slice(2));
  console.log(`\nAlpha Traders public App Review preflight: ${options.baseUrl}\n`);
  const results = await runReviewSurfaceChecks({
    ...options,
    onPass: (result) => console.log(`PASS  ${result.label}`),
  });
  console.log(`\nPublic App Review preflight passed (${results.length} checks).\n`);
}

const isMainModule = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((error) => {
    console.error(`\nPublic App Review preflight failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
