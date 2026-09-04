import { describe, expect, it } from "vitest";
import { buildSecurityHeaders } from "@/lib/security-headers";

function asHeaderMap(isProduction: boolean) {
  return new Map(buildSecurityHeaders({ isProduction }).map((header) => [header.key, header.value]));
}

function cspDirectives(isProduction: boolean) {
  const policy = asHeaderMap(isProduction).get("Content-Security-Policy") ?? "";
  return new Map(policy.split(";").map((directive) => {
    const [name, ...values] = directive.trim().split(/\s+/);
    return [name, values];
  }));
}

describe("browser security headers", () => {
  it("blocks framing, MIME sniffing, cross-site resource reuse, and legacy XSS filtering", () => {
    const headers = asHeaderMap(true);

    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-XSS-Protection")).toBe("0");
    expect(headers.get("X-Permitted-Cross-Domain-Policies")).toBe("none");
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin-allow-popups");
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe("same-site");
    expect(headers.get("Origin-Agent-Cluster")).toBe("?1");
  });

  it("blocks inline event handlers, plugins, external framing, and unsafe eval", () => {
    const directives = cspDirectives(true);

    expect(directives.get("script-src")).toContain("'unsafe-inline'");
    expect(directives.get("script-src")).not.toContain("'unsafe-eval'");
    expect(directives.get("script-src-attr")).toEqual(["'none'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
    expect(directives.get("form-action")).toEqual(["'self'"]);
  });

  it("upgrades mixed content only in production so local HTTP development keeps working", () => {
    expect(cspDirectives(true).has("upgrade-insecure-requests")).toBe(true);
    expect(cspDirectives(false).has("upgrade-insecure-requests")).toBe(false);
  });

  it("emits each security header exactly once", () => {
    const headers = buildSecurityHeaders({ isProduction: true });
    expect(new Set(headers.map((header) => header.key)).size).toBe(headers.length);
  });
});
