import { describe, expect, it } from "vitest";
import { isSafeAcademyUrl } from "../../apps/mobile/src/academy/academy-links";

describe("native Academy external links", () => {
  it.each([
    "https://www.alphatraders.co.il/files/course.pdf",
    "https://cdn.example.test/video.mp4",
  ])("accepts HTTPS content URLs (%s)", (url) => {
    expect(isSafeAcademyUrl(url)).toBe(true);
  });

  it.each([
    "http://www.alphatraders.co.il/file.pdf",
    "javascript:alert(1)",
    "file:///private/course.pdf",
    "https://user:password@example.test/file.pdf",
    "/relative/file.pdf",
    "not a url",
  ])("rejects unsafe Academy handoffs (%s)", (url) => {
    expect(isSafeAcademyUrl(url)).toBe(false);
  });
});
