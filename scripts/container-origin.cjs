"use strict";

function assertContainerNodeRuntime(version = process.versions.node) {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!parts || Number(parts[1]) !== 24 || Number(parts[2]) < 22
    || (Number(parts[2]) === 22 && Number(parts[3]) < 1)) {
    throw new Error("Container requires Node >=24.22.1 <25.");
  }
}

/** The public origin comes from deployment configuration, never request input. */
function resolveContainerOrigin(env = process.env) {
  if (env.NODE_ENV !== "production" || env.VERCEL !== "1" || env.PORT !== "8080") {
    throw new Error("Container production runtime configuration is invalid.");
  }
  let origin;
  if (env.VERCEL_ENV === "preview") {
    const host = env.VERCEL_URL;
    if (typeof host !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(host)) {
      throw new Error("Container Preview deployment hostname is invalid.");
    }
    origin = new URL(`https://${host}`);
  } else if (env.VERCEL_ENV === "production") {
    try { origin = new URL(env.NEXT_PUBLIC_SITE_URL); } catch {
      throw new Error("Container canonical site origin is invalid.");
    }
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.port
      || origin.pathname !== "/" || origin.search || origin.hash
      || !origin.hostname.includes(".") || !/^[a-z0-9.-]+$/.test(origin.hostname)
      || origin.hostname.endsWith(".") || /^[\d.]+$/.test(origin.hostname)
      || origin.hostname.endsWith(".localhost") || origin.hostname.endsWith(".invalid")) {
      throw new Error("Container canonical site origin is invalid.");
    }
  } else {
    throw new Error("Container deployment environment is invalid.");
  }
  return Object.freeze({ origin: origin.origin, hostname: origin.hostname, port: 443 });
}

function matchesHost(value, expected) {
  return typeof value === "string" &&
    (value.toLowerCase() === expected || value.toLowerCase() === `${expected}:443`);
}

/** Validate Vercel ingress before giving Next its pinned logical HTTPS origin. */
function validateContainerRequest(request, expected) {
  const headers = request.headers;
  if (!matchesHost(headers.host, expected.hostname)) return 421;
  if (Array.isArray(request.rawHeaders)) {
    let hosts = 0;
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      if (request.rawHeaders[i].toLowerCase() === "host") hosts++;
    }
    if (hosts !== 1) return 421;
  }
  if (headers["x-forwarded-host"] !== undefined &&
    !matchesHost(headers["x-forwarded-host"], expected.hostname)) return 421;
  if (headers["x-forwarded-proto"] !== "https") return 400;
  // These transport hints now agree with the server-owned origin. In particular,
  // leave Origin and Sec-Fetch-Site intact for the existing application CSRF gate.
  headers.host = expected.hostname;
  headers["x-forwarded-host"] = expected.hostname;
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-port"] = "443";
  return null;
}

module.exports = { assertContainerNodeRuntime, resolveContainerOrigin, validateContainerRequest };
