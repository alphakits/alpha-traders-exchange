import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { sanitizeProfileImage } from "@/lib/profile-image-sanitization";

describe("profile image sanitization", () => {
  it("fully decodes and removes private metadata", async () => {
    const source = await sharp({
      create: { width: 64, height: 40, channels: 3, background: "#c9a227" },
    })
      .jpeg()
      .withExif({ IFD0: { Artist: "private-device-and-location" } })
      .toBuffer();
    expect(source.includes(Buffer.from("private-device-and-location"))).toBe(true);

    const sanitized = await sanitizeProfileImage(source);
    const metadata = await sharp(sanitized.bytes).metadata();

    expect(sanitized.mimeType).toBe("image/webp");
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();
    expect(sanitized.bytes.includes(Buffer.from("private-device-and-location"))).toBe(false);
    expect([sanitized.width, sanitized.height]).toEqual([64, 40]);
  });

  it("rejects a signature-only fake image", async () => {
    await expect(sanitizeProfileImage(Buffer.from([0xff, 0xd8, 0xff]))).rejects.toThrow();
  });

  it("bounds large display dimensions", async () => {
    const source = await sharp({
      create: { width: 3_000, height: 1_000, channels: 3, background: "#050505" },
    }).png().toBuffer();
    const sanitized = await sanitizeProfileImage(source);
    expect(sanitized.width).toBe(2_048);
    expect(sanitized.height).toBeLessThanOrEqual(683);
  });
});
