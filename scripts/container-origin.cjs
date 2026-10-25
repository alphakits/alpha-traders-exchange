"use strict";

function assertContainerNodeRuntime(version = process.versions.node) {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!parts || Number(parts[1]) !== 24 || Number(parts[2]) < 22
    || (Number(parts[2]) === 22 && Number(parts[3]) < 1)) {
    throw new Error("Container requires Node >=24.22.1 <25.");
  }
}

function isPublicHostname(value) {
  return typeof value === "string" && value.length <= 253 && value === value.trim() && value === value.toLowerCase()
    && value.split(".").length > 1
    && value.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    && !/^[\d.]+$/.test(value)
    && !/\.(?:localhost|invalid|test|local|internal|example)$/.test(value);
}

function deploymentHostname(value) {
  if (!isPublicHostname(value) || !/^[a-z0-9-]+\.vercel\.app$/.test(value)) {
    throw new Error("Container deployment hostname is invalid.");
  }
  return value;
}

/** The public origin comes from deployment configuration, never request input. */
function resolveContainerOrigin(env = process.env) {
  if (env.NODE_ENV !== "production" || env.VERCEL !== "1" || env.PORT !== "8080") {
    throw new Error("Container production runtime configuration is invalid.");
  }
  let origin;
  let ingressHostnames;
  if (env.VERCEL_ENV === "preview") {
    const host = deploymentHostname(env.VERCEL_URL);
    origin = new URL(`https://${host}`);
    ingressHostnames = [host];
  } else if (env.VERCEL_ENV === "production") {
    try { origin = new URL(env.NEXT_PUBLIC_SITE_URL); } catch {
      throw new Error("Container canonical site origin is invalid.");
    }
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.port
      || origin.pathname !== "/" || origin.search || origin.hash
      || !isPublicHostname(origin.hostname)) {
      throw new Error("Container canonical site origin is invalid.");
    }
    // Vercel Cron invokes the deployment URL, independently of the site's
    // canonical domain. Accept only exact platform-owned environment values.
    ingressHostnames = [origin.hostname, deploymentHostname(env.VERCEL_URL)];
    if (env.VERCEL_PROJECT_PRODUCTION_URL !== undefined) {
      if (!isPublicHostname(env.VERCEL_PROJECT_PRODUCTION_URL)) {
        throw new Error("Container project production hostname is invalid.");
      }
      ingressHostnames.push(env.VERCEL_PROJECT_PRODUCTION_URL);
    }
    // A project can retain a vercel.app production alias in addition to its
    // custom domain. Configure that exact reviewed alias; never trust a suffix.
    if (env.ALPHA_CONTAINER_PRODUCTION_ALIAS !== undefined) {
      ingressHostnames.push(deploymentHostname(env.ALPHA_CONTAINER_PRODUCTION_ALIAS));
    }
  } else {
    throw new Error("Container deployment environment is invalid.");
  }
  return Object.freeze({ origin: origin.origin, hostname: origin.hostname, port: 443,
    production: env.VERCEL_ENV === "production", ingressHostnames: Object.freeze([...new Set(ingressHostnames)]) });
}

function matchesHost(value, expected) {
  return typeof value === "string" &&
    (value.toLowerCase() === expected || value.toLowerCase() === `${expected}:443`);
}

/** Validate Vercel ingress before giving Next its pinned logical HTTPS origin. */
function validateContainerRequest(request, expected) {
  const headers = request.headers;
  const incomingHostname = expected.ingressHostnames.find(host => matchesHost(headers.host, host));
  if (!incomingHostname) return 421;
  if (Array.isArray(request.rawHeaders)) {
    let hosts = 0;
    for (let i = 0; i < request.rawHeaders.length; i += 2) {
      if (request.rawHeaders[i].toLowerCase() === "host") hosts++;
    }
    if (hosts !== 1) return 421;
  }
  if (headers["x-forwarded-host"] !== undefined &&
    !matchesHost(headers["x-forwarded-host"], incomingHostname)) return 421;
  if (headers["x-forwarded-proto"] !== "https") return 400;
  // These transport hints now agree with the server-owned origin. In particular,
  // leave Origin and Sec-Fetch-Site intact for the existing application CSRF gate.
  headers.host = expected.hostname;
  headers["x-forwarded-host"] = expected.hostname;
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-port"] = "443";
  return null;
}

/** Compute before normalization, but issue only after ingress validation passes. */
function containerCanonicalRedirect(request, expected) {
  if (!expected.production || !["GET", "HEAD"].includes(request.method)) return null;
  const host = expected.ingressHostnames.find(value => matchesHost(request.headers.host, value));
  if (!host || host === expected.hostname || typeof request.url !== "string"
    || !request.url.startsWith("/")) return null;
  let target;
  try { target = new URL(request.url, expected.origin); } catch { return null; }
  if (target.origin !== expected.origin || target.pathname === "/api" || target.pathname.startsWith("/api/")) return null;
  return target.href;
}

module.exports = { assertContainerNodeRuntime, resolveContainerOrigin, validateContainerRequest, containerCanonicalRedirect };
