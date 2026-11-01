import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, emptyReview, type JournalReview, type JournalSettings } from "@/lib/journal/model";
import type { JournalAdapter } from "@/lib/journal/client";
import { JournalWorkspace } from "./journal-workspace";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

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

function journalAdapter(overrides: Partial<JournalAdapter> = {}): JournalAdapter {
  return {
    load: vi.fn(async () => ({ trades: [], reviews: [], settings: { ...DEFAULT_SETTINGS } })),
    saveReview: vi.fn(), saveTrade: vi.fn(), deleteTrade: vi.fn(), saveSettings: vi.fn(),
    charts: vi.fn(), uploadChart: vi.fn(), deleteChart: vi.fn(), ...overrides,
  };
}
function pendingSave<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("journal draft protection", () => {
  it.each(["Review", "Daily review", "Weekly review", "My rules"])("keeps the draft protected when reselecting %s", async current => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const adapter = journalAdapter();
    await act(async () => { render(<JournalWorkspace adapter={adapter}/>); });
    fireEvent.click(screen.getByRole("button", { name: current === "My rules" ? "My rules" : "Review" }));
    if (current === "Weekly review") fireEvent.click(screen.getByRole("button", { name: current }));
    const label = current === "My rules" ? "My trading plan" : "What I learned";
    const share = current === "My rules" ? "Share my plan" : current === "Weekly review" ? "Share this week" : "Share this day";
    fireEvent.change(screen.getByLabelText(label), { target: { value: "Keep my unsaved draft" } });
    fireEvent.click(screen.getByRole("button", { name: current }));
    expect(confirm).not.toHaveBeenCalled();
    expect((screen.getByLabelText(label) as HTMLTextAreaElement).value).toBe("Keep my unsaved draft");
    expect((screen.getByRole("button", { name: share }) as HTMLButtonElement).disabled).toBe(true);
    confirm.mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect((screen.getByLabelText(label) as HTMLTextAreaElement).value).toBe("Keep my unsaved draft");
    expect(adapter.saveReview).not.toHaveBeenCalled();
    expect(adapter.saveSettings).not.toHaveBeenCalled();
  });

  it("keeps a weekly draft protected when choosing another day in the same week", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => { render(<JournalWorkspace adapter={journalAdapter()}/>); });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Weekly review" }));
    fireEvent.change(screen.getByLabelText("Review date"), { target: { value: "2026-10-12" } });
    fireEvent.change(screen.getByLabelText("What I learned"), { target: { value: "Keep this week intact" } });
    fireEvent.change(screen.getByLabelText("Review date"), { target: { value: "2026-10-14" } });
    expect(confirm).not.toHaveBeenCalled();
    expect((screen.getByLabelText("What I learned") as HTMLTextAreaElement).value).toBe("Keep this week intact");
    expect((screen.getByRole("button", { name: "Share this week" }) as HTMLButtonElement).disabled).toBe(true);
    confirm.mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Next session" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect((screen.getByLabelText("Review date") as HTMLInputElement).value).toBe("2026-10-14");
  });

  it.each(["review", "rules"] as const)("does not let an old %s save clear another form's draft guard", async kind => {
    const pending = pendingSave<JournalReview | JournalSettings>();
    const initial = emptyReview("2026-10-18");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const adapter = journalAdapter(kind === "review"
      ? { saveReview: () => pending.promise as Promise<JournalReview> }
      : { saveSettings: () => pending.promise as Promise<JournalSettings> });
    await act(async () => { render(<JournalWorkspace adapter={adapter}/>); });
    fireEvent.click(screen.getByRole("button", { name: kind === "review" ? "Review" : "My rules" }));
    fireEvent.change(screen.getByLabelText(kind === "review" ? "What I learned" : "My trading plan"), { target: { value: "First save" } });
    fireEvent.click(screen.getByRole("button", { name: kind === "review" ? "Save review" : "Save rules" }));
    fireEvent.click(screen.getByRole("button", { name: kind === "review" ? "My rules" : "Review" }));
    const currentLabel = kind === "review" ? "My trading plan" : "What I learned";
    fireEvent.change(screen.getByLabelText(currentLabel), { target: { value: "New unsaved draft" } });
    await act(async () => pending.resolve(kind === "review" ? { ...initial, improve: "First save", version: 1 } : { ...DEFAULT_SETTINGS, rules: "First save", version: 1 }));
    expect((screen.getByLabelText(currentLabel) as HTMLTextAreaElement).value).toBe("New unsaved draft");
    expect((screen.getByRole("button", { name: kind === "review" ? "Share my plan" : "Share this day" }) as HTMLButtonElement).disabled).toBe(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    confirm.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect((screen.getByLabelText(currentLabel) as HTMLTextAreaElement).value).toBe("New unsaved draft");
  });
});
