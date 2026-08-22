import { NextResponse } from "next/server";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";
import { isProductionSecurityRuntime } from "@/lib/runtime-safety";

type RateLimitWindow = {
  count: number;
  windowStart: number;
};

const buckets = new Map<string, RateLimitWindow>();
let sharedRateLimitSchema: Promise<void> | null = null;

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
  const configuredMax = Number.isFinite(maxRequests) && maxRequests > 0 ? maxRequests : input.maxRequests;
  const configuredWindow = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : input.windowMs;
  // In production, environment overrides may tighten a limit but cannot make
  // a protected route easier to abuse.
  return isProductionSecurityRuntime()
    ? {
      maxRequests: Math.min(configuredMax, input.maxRequests),
      windowMs: Math.max(configuredWindow, input.windowMs),
    }
    : { maxRequests: configuredMax, windowMs: configuredWindow };
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

async function ensureSharedRateLimitSchema() {
  if (!sharedRateLimitSchema) {
    const pool = getRuntimePostgresPool();
    if (!pool) return false;
    sharedRateLimitSchema = pool.query(`
      create table if not exists alpha_exchange.rate_limit_windows (
        bucket_key text primary key,
        window_started_at timestamptz not null,
        request_count integer not null check (request_count >= 0)
      )
    `).then(() => undefined);
  }
  try {
    await sharedRateLimitSchema;
  } catch (error) {
    sharedRateLimitSchema = null;
    throw error;
  }
  return true;
}

/**
 * Uses PostgreSQL as a cross-instance fixed-window limiter when runtime
 * persistence is configured. Development and isolated tests retain the local
 * limiter because they intentionally run without PostgreSQL.
 */
export async function checkSharedRateLimit(input: {
  headers: Headers;
  key: string;
  maxRequests: number;
  windowMs: number;
  identifier?: string;
}) {
  const config = resolveRateLimitConfig(input);
  const ip = resolveClientIp(input.headers);
  const identifier = input.identifier?.trim() || ip;
  const bucketKey = `${input.key}:${identifier}`;
  let pool: ReturnType<typeof getRuntimePostgresPool>;
  try {
    pool = getRuntimePostgresPool();
  } catch {
    if (isProductionSecurityRuntime()) {
      return { allowed: false, retryAfterSeconds: 30, reason: "limiter_unavailable" as string };
    }
    return checkRateLimit({ ...input, maxRequests: config.maxRequests, windowMs: config.windowMs });
  }
  if (!pool) {
    if (isProductionSecurityRuntime()) {
      return { allowed: false, retryAfterSeconds: 30, reason: "limiter_unavailable" as string };
    }
    return checkRateLimit({ ...input, maxRequests: config.maxRequests, windowMs: config.windowMs });
  }

  try {
    const ready = await ensureSharedRateLimitSchema();
    if (!ready) {
      return checkRateLimit({ ...input, maxRequests: config.maxRequests, windowMs: config.windowMs });
    }
    const result = await pool.query<{ request_count: number; window_started_at: Date }>(
      `insert into alpha_exchange.rate_limit_windows as rate_limit (bucket_key, window_started_at, request_count)
       values ($1, now(), 1)
       on conflict (bucket_key) do update
       set window_started_at = case
             when rate_limit.window_started_at <= now() - ($2::bigint * interval '1 millisecond') then now()
             else rate_limit.window_started_at
           end,
           request_count = case
             when rate_limit.window_started_at <= now() - ($2::bigint * interval '1 millisecond') then 1
             else rate_limit.request_count + 1
           end
       returning request_count, window_started_at`,
      [bucketKey, config.windowMs],
    );
    const row = result.rows[0];
    const elapsedMs = Date.now() - new Date(row.window_started_at).getTime();
    const retryAfterSeconds = Math.max(1, Math.ceil((config.windowMs - elapsedMs) / 1000));
    return row.request_count <= config.maxRequests
      ? { allowed: true, retryAfterSeconds: 0, reason: null as string | null }
      : { allowed: false, retryAfterSeconds, reason: "limit_reached" as string };
  } catch {
    // The application requires PostgreSQL in production. Fail closed for
    // sensitive flows rather than silently falling back to a per-instance map.
    if (isProductionSecurityRuntime()) {
      return { allowed: false, retryAfterSeconds: 30, reason: "limiter_unavailable" as string };
    }
    return checkRateLimit({ ...input, maxRequests: config.maxRequests, windowMs: config.windowMs });
  }
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
