/** Edge-compatible IP parsing. Never use an arbitrary header as an identity. */
export function normalizeClientIp(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value || value.length > 45) return null;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    const parts = value.split(".");
    return parts.every((part) => String(Number(part)) === part && Number(part) <= 255)
      ? value : null;
  }
  if (!value.includes(":") || !/^[0-9a-f:.]+$/i.test(value)) return null;
  try {
    const ip = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    // Give an IPv4 address and its mapped IPv6 spelling the same limit bucket.
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
    if (mapped) {
      const high = parseInt(mapped[1], 16);
      const low = parseInt(mapped[2], 16);
      return [high >> 8, high & 255, low >> 8, low & 255].join(".");
    }
    return ip;
  } catch {
    return null;
  }
}

export function resolveClientIp(headers: Headers): string {
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV) {
    // Vercel overwrites these headers at ingress. In particular, do not trust
    // cf-connecting-ip on a direct Vercel deployment or pick an IP from a
    // caller-supplied comma-separated chain. Invalid trusted input fails closed.
    const value = headers.get("x-vercel-forwarded-for")
      ?? headers.get("x-forwarded-for")
      ?? headers.get("x-real-ip");
    return normalizeClientIp(value) ?? "unknown";
  }
  // Other production hosts need an explicitly designed trusted ingress policy.
  if (process.env.NODE_ENV === "production") return "unknown";
  const local = headers.get("x-vercel-forwarded-for")
    ?? headers.get("x-real-ip")
    ?? headers.get("x-forwarded-for")?.split(",")[0];
  return normalizeClientIp(local) ?? "unknown";
}

export function isPublicClientIp(ip: string): boolean {
  const normalized = normalizeClientIp(ip);
  if (!normalized) return false;
  if (normalized.includes(":")) {
    // Global unicast only; exclude documentation and special-purpose ranges.
    return /^[23]/.test(normalized)
      && !/^2001:(?:db8|0|2|10|20)(?::|$)/.test(normalized);
  }
  const [a, b, c] = normalized.split(".").map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a < 224
    && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 169 && b === 254)
    && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2))))
    && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    && !(a === 203 && b === 0 && c === 113);
}
