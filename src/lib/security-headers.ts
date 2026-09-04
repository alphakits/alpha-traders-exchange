export type SecurityHeader = {
  key: string;
  value: string;
};

export function buildSecurityHeaders(input: { isProduction: boolean }): SecurityHeader[] {
  const contentSecurityPolicy = [
    "default-src 'self'",
    // Next.js currently emits framework-owned inline bootstrap scripts. Keep
    // script elements compatible while independently blocking HTML event
    // handler attributes such as onclick, which are a common XSS target.
    "script-src 'self' 'unsafe-inline'",
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https:",
    "media-src 'self' https: blob:",
    "frame-src 'self' https://s.tradingview.com https://www.tradingview.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(input.isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  return [
    { key: "X-DNS-Prefetch-Control", value: "on" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    // Disable the obsolete reflective-XSS filter; the CSP above is the
    // authoritative browser protection and avoids legacy filter quirks.
    { key: "X-XSS-Protection", value: "0" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "Cross-Origin-Resource-Policy", value: "same-site" },
    { key: "Origin-Agent-Cluster", value: "?1" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
  ];
}
