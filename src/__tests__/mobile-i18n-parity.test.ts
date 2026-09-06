import { describe, expect, it } from "vitest";
import { messages } from "../../apps/mobile/src/i18n/messages";

describe("native English and Arabic copy parity", () => {
  it("keeps every native message available in both languages", () => {
    expect(Object.keys(messages.ar).sort()).toEqual(Object.keys(messages.en).sort());
    for (const key of Object.keys(messages.en) as Array<keyof typeof messages.en>) {
      expect(messages.en[key].trim()).not.toBe("");
      expect(messages.ar[key].trim()).not.toBe("");
    }
  });
});
