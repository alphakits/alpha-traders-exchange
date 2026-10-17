import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueuedAutosave } from "./queued-autosave";
const draft = (id: string, title = id) => ({ id, title });
function fixture() {
  const callbacks = { save: vi.fn(async (value: ReturnType<typeof draft>, signal: AbortSignal) => { void signal; return value; }), onSaved: vi.fn(), onError: vi.fn(), onState: vi.fn() };
  return { ...callbacks, queue: createQueuedAutosave({ ...callbacks, delayMs: 10, timeoutMs: 100 }) };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("queued owner autosave", () => {
  it("carries an acknowledged revision into newer edits without replacing their content", async () => {
    type Versioned = ReturnType<typeof draft> & { updatedAt: string };
    let finish!: (value: Versioned) => void;
    const save = vi.fn(async (value: Versioned) => value).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const queue = createQueuedAutosave<Versioned>({ save, onSaved: vi.fn(), onError: vi.fn(), onState: vi.fn(),
      rebase: (pending, saved) => ({ ...pending, updatedAt: saved.updatedAt }), delayMs: 10 });
    queue.enqueue({ ...draft("one", "old"), updatedAt: "1" }); await vi.advanceTimersByTimeAsync(10);
    queue.enqueue({ ...draft("one", "new"), updatedAt: "1" });
    finish({ ...draft("one", "old"), updatedAt: "2" }); await vi.advanceTimersByTimeAsync(10);
    expect(save.mock.calls[1][0]).toEqual({ ...draft("one", "new"), updatedAt: "2" });
  });
  it("retains edits for both lessons when selection changes before saving", async () => {
    const f = fixture(); f.queue.enqueue(draft("first")); f.queue.enqueue(draft("second"));
    await vi.advanceTimersByTimeAsync(30);
    expect(f.save.mock.calls.map(([value]) => value.id)).toEqual(["first", "second"]);
    expect(f.onSaved).toHaveBeenCalledTimes(2);
    expect(f.onState).toHaveBeenLastCalledWith({ saving: false, dirty: false, failed: false });
  });
  it("never applies an old response over a newer edit and serializes the next write", async () => {
    const f = fixture(); let finish!: (value: ReturnType<typeof draft>) => void;
    f.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.queue.enqueue(draft("one", "old")); await vi.advanceTimersByTimeAsync(10);
    f.queue.enqueue(draft("one", "new")); await vi.advanceTimersByTimeAsync(10);
    expect(f.save).toHaveBeenCalledTimes(1);
    finish(draft("one", "old")); await vi.advanceTimersByTimeAsync(0);
    expect(f.onSaved).not.toHaveBeenCalled();
    expect(f.queue.getDraft("one")?.title).toBe("new");
    await vi.advanceTimersByTimeAsync(10);
    expect(f.onSaved).toHaveBeenCalledExactlyOnceWith(draft("one", "new"));
  });
  it("retains failed edits, clears saving, and retries only when requested", async () => {
    const f = fixture(); f.save.mockRejectedValueOnce(new Error("session expired"));
    f.queue.enqueue(draft("one")); await vi.advanceTimersByTimeAsync(1000);
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.queue.merge([draft("one", "server")])).toEqual([draft("one")]);
    expect(f.onState).toHaveBeenLastCalledWith({ saving: false, dirty: true, failed: true });
    f.queue.retry(); await vi.advanceTimersByTimeAsync(0);
    expect(f.onSaved).toHaveBeenCalledExactlyOnceWith(draft("one"));
  });
  it("ends a hung request, preserves the draft and ignores a late response", async () => {
    const f = fixture(); let finish!: (value: ReturnType<typeof draft>) => void;
    f.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.queue.enqueue(draft("one")); await vi.advanceTimersByTimeAsync(110);
    expect(f.save.mock.calls[0][1].aborted).toBe(true);
    expect(f.onState).toHaveBeenLastCalledWith({ saving: false, dirty: true, failed: true });
    finish(draft("one")); await vi.advanceTimersByTimeAsync(0);
    expect(f.onSaved).not.toHaveBeenCalled();
  });
  it("does not resurrect a deleted lesson from an outstanding response", async () => {
    const f = fixture(); let finish!: (value: ReturnType<typeof draft>) => void;
    f.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    f.queue.enqueue(draft("one")); await vi.advanceTimersByTimeAsync(10);
    f.queue.remove("one"); finish(draft("one")); await vi.advanceTimersByTimeAsync(0);
    expect(f.onSaved).not.toHaveBeenCalled(); expect(f.queue.hasDraft("one")).toBe(false);
  });
  it("rejects a mismatched response and preserves the actual lesson", async () => {
    const f = fixture(); f.save.mockResolvedValueOnce(draft("other")); f.queue.enqueue(draft("one"));
    await vi.advanceTimersByTimeAsync(10);
    expect(f.onSaved).not.toHaveBeenCalled(); expect(f.queue.hasDraft("one")).toBe(true);
  });
});
