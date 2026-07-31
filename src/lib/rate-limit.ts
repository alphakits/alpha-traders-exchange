import { NextResponse } from "next/server";

type RateLimitWindow = {
  count: number;
  windowStart: number;
};

const buckets = new Map<string, RateLimitWindow>();

function getClientIp(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return headers.get("x-real-ip") || "unknown";
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
}) {
  const ip = getClientIp(input.headers);
  const config = resolveRateLimitConfig(input);
  const now = Date.now();
  const bucketKey = `${input.key}:${ip}`;
  const existing = buckets.get(bucketKey);
  if (!existing || now - existing.windowStart > config.windowMs) {
    buckets.set(bucketKey, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (existing.count >= config.maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((config.windowMs - (now - existing.windowStart)) / 1000));
    return { allowed: false, retryAfterSeconds };
  }
  existing.count += 1;
  buckets.set(bucketKey, existing);
  return { allowed: true, retryAfterSeconds: 0 };
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
