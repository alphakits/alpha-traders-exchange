/* Local preview only. Loaded before Next and inherited by its worker processes. */
const net = require("node:net");
const http = require("node:http");
const { syncBuiltinESMExports } = require("node:module");

if (process.env.ALPHA_USDT_OFFLINE_PREVIEW !== "1" || process.env.VERCEL || process.env.VERCEL_ENV) {
  throw new Error("The offline network guard requires the isolated local preview launcher.");
}

if (!globalThis.__alphaUsdtOfflineNetworkGuard) {
  globalThis.__alphaUsdtOfflineNetworkGuard = true;
  const local = (host) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(String(host).toLowerCase());
  const denied = () => Object.assign(new Error("External networking is disabled in the USDT offline preview."), { code: "USDT_OFFLINE_NETWORK_BLOCKED" });
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const first = args[0];
    // Node normalizes connect arguments into an array in some built-in clients.
    const options = Array.isArray(first) ? first[0] : typeof first === "object" ? first : null;
    if (options?.path || (typeof first === "string" && !/^\d+$/.test(first))) {
      throw denied();
    }
    const host = options?.host ?? (typeof args[1] === "string" ? args[1] : "localhost");
    if (!local(host)) throw denied();
    return originalConnect.apply(this, args);
  };
  syncBuiltinESMExports();

  // This marker exists only in a process loaded through this network guard.
  // Fixture helpers refuse generic test-enabled servers without these guards.
  const originalEmit = http.Server.prototype.emit;
  const originalSetHeader = http.ServerResponse.prototype.setHeader;
  http.ServerResponse.prototype.setHeader = function (name, value) {
    if (String(name).toLowerCase() === "content-security-policy" && typeof value === "string") {
      value = value.replace(/connect-src[^;]*/, "connect-src 'self' ws://127.0.0.1:* ws://localhost:*")
        .replace(/img-src[^;]*/, "img-src 'self' data: blob:").replace(/media-src[^;]*/, "media-src 'self' blob:");
      // Next dev's refresh loader evaluates its own bundle. This exception is
      // confined to this isolated process; production source CSP stays intact.
      if (process.env.NODE_ENV === "development") value = value.replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    }
    return originalSetHeader.call(this, name, value);
  };
  http.Server.prototype.emit = function (event, ...args) {
    if (event === "request" && args[0]?.method === "GET" && args[0]?.url === "/__usdt-offline-health") {
      const safe = process.env.ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY === "1"
        && process.env.ALPHA_USDT_REQUEST_EMAIL_DELIVERY_ENABLED === "0";
      args[1].writeHead(safe ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      args[1].end(JSON.stringify({ kind: "alpha-usdt-offline-preview-v1", isolated: safe, externalNetworkBlocked: true }));
      return true;
    }
    return originalEmit.call(this, event, ...args);
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.href === "https://usdt-offline.invalid/quote") {
      return Response.json({ base: "USD", quote: "ILS", symbol: "WISE:USDILS", price: 3.30,
        quotedAt: new Date().toISOString(), marketState: "open" });
    }
    if (!local(url.hostname) || !["http:", "https:"].includes(url.protocol)) throw denied();
    return originalFetch(input, init);
  };
}
