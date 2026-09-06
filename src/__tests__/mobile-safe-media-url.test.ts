import { describe, expect, it } from "vitest";
import { safeRemoteImageUrl } from "../../apps/mobile/src/media/safe-media-url";
import { safeMobileMediaUrl } from "@/lib/mobile-safe-media-url";

describe.each([
  ["server", safeMobileMediaUrl],
  ["native client", safeRemoteImageUrl],
] as const)("%s remote media URL boundary", (_label, sanitize) => {
  it("keeps absolute credential-free HTTPS media URLs", () => {
    expect(sanitize(" https://cdn.example/avatar.webp ")).toBe("https://cdn.example/avatar.webp");
  });

  it.each([
    "http://cdn.example/avatar.webp",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    "https://username:password@cdn.example/avatar.webp",
    "/images/avatar.webp",
    "not a url",
    "",
  ])("rejects unsafe media URL %s", (value) => {
    expect(sanitize(value)).toBe("");
  });

  it("rejects unexpectedly large URLs", () => {
    expect(sanitize(`https://cdn.example/${"x".repeat(2_100)}`)).toBe("");
  });
});
