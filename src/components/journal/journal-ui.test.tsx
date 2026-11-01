import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { JournalTrade } from "@/lib/journal/model";
import { EquityChart } from "./journal-ui";

afterEach(cleanup);

const trade = (date: string, grossPnlCents: number): JournalTrade => ({
  id: date, version: 1, date, time: "12:00", symbol: "NQ", direction: "long", status: "closed",
  grossPnlCents, feesCents: 100, riskCents: null, quantity: null, entry: null, exit: null,
  stop: null, target: null, strategy: "", session: "", emotion: "", followedPlan: null, mistakes: [], notes: "",
});

describe("journal equity chart keyboard exploration", () => {
  it.each(["Home", "End", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"])("selects a single trading day with %s after clearing exploration", key => {
    render(<EquityChart trades={[trade("2026-11-01", 10100)]} locale="en" />);
    const explorer = screen.getByRole("slider", { name: "Explore daily results" });
    fireEvent.keyDown(explorer, { key });
    expect(screen.getByText("Session net")).toBeTruthy();
    expect(explorer.getAttribute("aria-valuetext")).toContain("+$100.00");
    fireEvent.keyDown(explorer, { key: "Escape" });
    expect(screen.queryByText("Session net")).toBeNull();
    fireEvent.keyDown(explorer, { key });
    expect(screen.getByText("Session net")).toBeTruthy();
  });

  it("moves between exact daily cumulative totals without changing their order in Arabic", () => {
    render(<EquityChart trades={[trade("2026-10-31", 10100), trade("2026-11-01", -2400)]} locale="ar" />);
    const explorer = screen.getByRole("slider", { name: "استكشاف النتائج اليومية" });
    fireEvent.keyDown(explorer, { key: "End" });
    expect(screen.getByText("صافي الجلسة")).toBeTruthy();
    expect(explorer.getAttribute("aria-valuetext")).toContain("+$75.00");
    fireEvent.keyDown(explorer, { key: "Home" });
    expect(explorer.getAttribute("aria-valuetext")).toContain("+$100.00");
    fireEvent.keyDown(explorer, { key: "ArrowRight" });
    expect(explorer.getAttribute("aria-valuetext")).toContain("+$75.00");
    fireEvent.keyDown(explorer, { key: "ArrowLeft" });
    expect(explorer.getAttribute("aria-valuetext")).toContain("+$100.00");
  });
});
