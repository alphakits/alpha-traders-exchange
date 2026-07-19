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

export function checkRateLimit(input: {
  headers: Headers;
  key: string;
  maxRequests: number;
  windowMs: number;
}) {
  const ip = getClientIp(input.headers);
  const now = Date.now();
  const bucketKey = `${input.key}:${ip}`;
  const existing = buckets.get(bucketKey);
  if (!existing || now - existing.windowStart > input.windowMs) {
    buckets.set(bucketKey, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (existing.count >= input.maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((input.windowMs - (now - existing.windowStart)) / 1000));
    return { allowed: false, retryAfterSeconds };
  }
  existing.count += 1;
  buckets.set(bucketKey, existing);
  return { allowed: true, retryAfterSeconds: 0 };
}
