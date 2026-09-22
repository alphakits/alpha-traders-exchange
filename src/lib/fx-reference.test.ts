import { describe, expect, it } from "vitest";
import { parseFxReference } from "./fx-reference";
describe("FX reference data", () => {
  it("sorts the real series and keeps current-date quotes separate from old rates", () => {
    expect(parseFxReference([
      { date: "2026-09-22", base: "USD", quote: "ILS", rate: 3.4 },
      { date: "2026-09-21", base: "USD", quote: "EUR", rate: 0.85 },
      { date: "2026-09-21", base: "USD", quote: "ILS", rate: 3.3 },
      { date: "2026-09-22", base: "USD", quote: "EUR", rate: 0.86 },
      { date: "2026-09-22", base: "EUR", quote: "ILS", rate: 4 },
      { date: "2026-09-22", base: "USD", quote: "RON", rate: -5 },
    ])).toEqual({ date: "2026-09-22", rates: { ILS: 3.4, EUR: 0.86 }, history: [{ date: "2026-09-21", rate: 3.3 }, { date: "2026-09-22", rate: 3.4 }] });
  });
  it.each([null, {}, [], [{ date: "2026-09-22", base: "USD", quote: "ILS", rate: NaN }]])("rejects missing or invalid prices instead of inventing a chart", (input) => {
    expect(() => parseFxReference(input)).toThrow();
  });
});
