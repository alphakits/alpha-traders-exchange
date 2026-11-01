import { createRequire } from "node:module";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { quote } = require("shell-quote") as {
  quote(parts: Array<string | { comment: string }>): string;
};

describe("patched image and shell dependencies", () => {
  it("keeps the native image pipeline working with a small trusted SVG", async () => {
    const input = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>');
    const output = await sharp(input).png().toBuffer();
    const metadata = await sharp(output).metadata();
    expect(metadata).toMatchObject({ format: "png", width: 2, height: 2 });
  });
  it("rejects every line terminator after a comment without invoking a shell", () => {
    for (const terminator of ["\n", "\r", "\u2028", "\u2029"]) {
      expect(() => quote(["alpha", { comment: "safe test" }, `${terminator}sentinel`])).toThrow(TypeError);
    }
    expect(quote(["alpha", "two words"])).toBe("alpha 'two words'");
  });
});
