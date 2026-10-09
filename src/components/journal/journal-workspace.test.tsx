import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/journal/model";
import type { JournalAdapter } from "@/lib/journal/client";
import { JournalWorkspace } from "./journal-workspace";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("journal session dates", () => {
  it.each([
    ["America/Los_Angeles", "2026-11-01T00:30:00Z", "2026-10-31"],
    ["Asia/Tokyo", "2026-10-31T21:30:00Z", "2026-11-01"],
  ])("opens and saves the review on the member's day in %s", async (timezone, now, expectedDate) => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(now));
    const adapter: JournalAdapter = {
      load: vi.fn(async () => ({ trades: [], reviews: [], settings: { ...DEFAULT_SETTINGS, timezone } })),
      saveReview: vi.fn(async review => ({ ...review, version: 1 })),
      saveTrade: vi.fn(), deleteTrade: vi.fn(), saveSettings: vi.fn(), charts: vi.fn(), uploadChart: vi.fn(), deleteChart: vi.fn(),
    };
    await act(async () => { render(<JournalWorkspace adapter={adapter}/>); });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect((screen.getByLabelText("Review date") as HTMLInputElement).value).toBe(expectedDate);
    fireEvent.change(screen.getByLabelText("What I learned"), { target: { value: "Review the correct local session" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save review" })); });
    expect(adapter.saveReview).toHaveBeenCalledWith(expect.objectContaining({ date: expectedDate, period: "day", improve: "Review the correct local session" }));

    // Opening a past session is intentional and must survive a refresh.
    fireEvent.change(screen.getByLabelText("Review date"), { target: { value: "2026-09-15" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reload journal" })); });
    expect((screen.getByLabelText("Review date") as HTMLInputElement).value).toBe("2026-09-15");
  });
});
