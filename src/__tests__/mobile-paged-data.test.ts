import { describe, expect, it } from "vitest";
import { mergeUniquePages, nextPageOffset } from "../../apps/mobile/src/query/paged-data";

describe("native paged collection merging", () => {
  it("preserves page order while removing overlap from refreshed pages", () => {
    expect(mergeUniquePages([
      [{ id: "one", value: 1 }, { id: "two", value: 2 }],
      [{ id: "two", value: 20 }, { id: "three", value: 3 }],
    ])).toEqual([
      { id: "one", value: 1 },
      { id: "two", value: 2 },
      { id: "three", value: 3 },
    ]);
  });

  it("caps a live collection while honoring the server's next offset", () => {
    expect(nextPageOffset({ nextOffset: 30 }, 1)).toBe(30);
    expect(nextPageOffset({ nextOffset: null }, 1)).toBeUndefined();
    expect(nextPageOffset({ nextOffset: 120 }, 4)).toBeUndefined();
  });
});
