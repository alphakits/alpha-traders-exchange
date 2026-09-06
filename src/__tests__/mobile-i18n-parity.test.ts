import { describe, expect, it } from "vitest";
import { messages } from "../../apps/mobile/src/i18n/messages";
import { academyCopy } from "../../apps/mobile/src/academy/academy-copy";

describe("native English and Arabic copy parity", () => {
  it("keeps every native message available in both languages", () => {
    expect(Object.keys(messages.ar).sort()).toEqual(Object.keys(messages.en).sort());
    for (const key of Object.keys(messages.en) as Array<keyof typeof messages.en>) {
      expect(messages.en[key].trim()).not.toBe("");
      expect(messages.ar[key].trim()).not.toBe("");
    }
  });

  it("keeps every native Academy message available in both languages", () => {
    expect(Object.keys(academyCopy.ar).sort()).toEqual(Object.keys(academyCopy.en).sort());
    for (const key of Object.keys(academyCopy.en) as Array<keyof typeof academyCopy.en>) {
      expect(academyCopy.en[key].trim()).not.toBe("");
      expect(academyCopy.ar[key].trim()).not.toBe("");
    }
  });
});
