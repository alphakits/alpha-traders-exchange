import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, emptyReview } from "@/lib/journal/model";
import type { JournalAdapter } from "@/lib/journal/client";
import { ReviewForm, RulesForm } from "./journal-review";

afterEach(cleanup);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function adapter(overrides: Partial<JournalAdapter>): JournalAdapter {
  return {
    load: vi.fn(), saveTrade: vi.fn(), deleteTrade: vi.fn(), saveReview: vi.fn(), saveSettings: vi.fn(),
    charts: vi.fn(), uploadChart: vi.fn(), deleteChart: vi.fn(), ...overrides,
  };
}

describe("journal saves on a slow connection", () => {
  it("holds a review stable while saving, then allows editing the saved result", async () => {
    const initial = emptyReview("2026-10-08", "day");
    const pending = deferred<typeof initial>();
    const onSaved = vi.fn();
    render(<ReviewForm initial={initial} locale="en" adapter={adapter({ saveReview: () => pending.promise })} onSaved={onSaved} onDirty={vi.fn()}/>);
    const notes = screen.getByLabelText("What I learned") as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "Wait for confirmation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save review" }));
    expect(notes.matches(":disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Execution score 4/5" }).matches(":disabled")).toBe(true);
    await act(async () => pending.resolve({ ...initial, improve: "Wait for confirmation", version: 1 }));
    expect(notes.matches(":disabled")).toBe(false); expect(notes.value).toBe("Wait for confirmation");
    expect(onSaved).toHaveBeenCalledOnce(); expect(screen.getByText("Review saved")).toBeTruthy();
  });
  it("retains the edited plan and allows retry after a settings save fails", async () => {
    const pending = deferred<typeof DEFAULT_SETTINGS>();
    const onSaved = vi.fn();
    render(<RulesForm initial={DEFAULT_SETTINGS} locale="en" adapter={adapter({ saveSettings: () => pending.promise })} onSaved={onSaved} onDirty={vi.fn()}/>);
    const rules = screen.getByLabelText("My trading plan") as HTMLTextAreaElement;
    fireEvent.change(rules, { target: { value: "My unsaved plan must survive" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
    expect(rules.matches(":disabled")).toBe(true);
    await act(async () => pending.reject(new Error("Connection interrupted")));
    expect(rules.matches(":disabled")).toBe(false); expect(rules.value).toBe("My unsaved plan must survive");
    expect(onSaved).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toBeTruthy();
  });
});
