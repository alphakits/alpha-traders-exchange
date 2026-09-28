import { describe, expect, it } from "vitest";
import { formatIsraelCalendarDateKey, israelCalendarDayNumber } from "@/lib/israel-calendar";

describe("Israel calendar helpers", () => {
  it("uses the Israel day across summer and winter UTC boundaries", () => {
    expect(formatIsraelCalendarDateKey("2026-08-27T21:30:00.000Z")).toBe("2026-08-28");
    expect(formatIsraelCalendarDateKey("2026-12-31T22:30:00.000Z")).toBe("2027-01-01");
  });

  it("returns stable calendar-day numbers and rejects invalid dates", () => {
    expect(israelCalendarDayNumber("2026-08-27T21:30:00.000Z") - israelCalendarDayNumber("2026-08-26T21:30:00.000Z")).toBe(1);
    expect(formatIsraelCalendarDateKey("not-a-date")).toBe("");
    expect(israelCalendarDayNumber("not-a-date")).toBeNaN();
  });
});
