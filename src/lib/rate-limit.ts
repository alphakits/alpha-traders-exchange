import { NextResponse } from "next/server";

type RateLimitWindow = {
  count: number;
  windowStart: number;
};

const buckets = new Map<string, RateLimitWindow>();

const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function normalizeIp(raw: string | null | undefined) {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("::ffff:")) {
    return value.slice(7);
  }
  return value;
}

function isLikelyPrivateIp(ip: string) {
  if (ip === "unknown" || ip === "127.0.0.1" || ip === "::1") return true;
  if (IPV4_PATTERN.test(ip)) {
    const [a, b] = ip.split(".").map((part) => Number(part));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

export function resolveClientIp(headers: Headers) {
  const directCandidates = [
    headers.get("x-vercel-forwarded-for"),
    headers.get("cf-connecting-ip"),
    headers.get("x-real-ip"),
  ];
  for (const candidate of directCandidates) {
    const ip = normalizeIp(candidate);
    if (ip) return ip;
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const chain = forwarded
      .split(",")
      .map((part) => normalizeIp(part))
      .filter((part): part is string => Boolean(part));
    const publicCandidate = chain.find((candidate) => !isLikelyPrivateIp(candidate));
    if (publicCandidate) return publicCandidate;
    if (chain.length > 0) return chain[0];
  }

  return "unknown";
}

function envKeyForRateLimit(baseKey: string, field: "MAX" | "WINDOW_MS") {
  const normalized = baseKey
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return `RATE_LIMIT_${normalized}_${field}`;
}

function resolveRateLimitConfig(input: { key: string; maxRequests: number; windowMs: number }) {
  const maxEnv = process.env[envKeyForRateLimit(input.key, "MAX")];
  const windowEnv = process.env[envKeyForRateLimit(input.key, "WINDOW_MS")];
  const maxRequests = Number(maxEnv ?? input.maxRequests);
  const windowMs = Number(windowEnv ?? input.windowMs);
  return {
    maxRequests: Number.isFinite(maxRequests) && maxRequests > 0 ? maxRequests : input.maxRequests,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : input.windowMs,
  };
}

export function checkRateLimit(input: {
  headers: Headers;
  key: string;
  maxRequests: number;
  windowMs: number;
  identifier?: string;
}) {
  const ip = resolveClientIp(input.headers);
  const identifier = input.identifier?.trim() || ip;
  const config = resolveRateLimitConfig(input);
  const now = Date.now();
  const bucketKey = `${input.key}:${identifier}`;
  const existing = buckets.get(bucketKey);
  if (!existing || now - existing.windowStart > config.windowMs) {
    buckets.set(bucketKey, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0, reason: null as string | null };
  }
  if (existing.count >= config.maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((config.windowMs - (now - existing.windowStart)) / 1000));
    return { allowed: false, retryAfterSeconds, reason: "limit_reached" as string };
  }
  existing.count += 1;
  buckets.set(bucketKey, existing);
  return { allowed: true, retryAfterSeconds: 0, reason: null as string | null };
}

export function createRateLimitResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many requests. Please try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
