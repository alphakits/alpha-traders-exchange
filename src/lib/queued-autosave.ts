type Identified = { id: string };
export type AutosaveState = { saving: boolean; dirty: boolean; failed: boolean };

/** One active write, with the latest unsaved revision retained per record. */
export function createQueuedAutosave<T extends Identified>(options: {
  save: (value: T, signal: AbortSignal) => Promise<T>;
  onSaved: (value: T) => void;
  onError: (error: unknown, value: T) => void;
  onState: (state: AutosaveState) => void;
  rebase?: (pending: T, saved: T) => T;
  onAcknowledged?: (saved: T) => void;
  delayMs?: number;
  timeoutMs?: number;
}) {
  const dirty = new Map<string, { revision: number; value: T }>();
  const acknowledged = new Map<string, T>();
  const queued = new Set<string>();
  const failed = new Set<string>();
  let revision = 0, active = false, disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const emit = () => { if (!disposed) options.onState({ saving: active, dirty: dirty.size > 0, failed: failed.size > 0 }); };
  const schedule = (delay = options.delayMs ?? 900) => {
    if (timer) clearTimeout(timer);
    if (!disposed) timer = setTimeout(() => { timer = undefined; void drain(); }, delay);
  };
  async function drain() {
    if (active || disposed) return;
    const id = queued.values().next().value as string | undefined;
    if (!id) return;
    queued.delete(id);
    const entry = dirty.get(id);
    if (!entry) { if (queued.size) schedule(0); return; }
    active = true; controller = new AbortController(); emit();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const saved = await Promise.race([
        options.save(entry.value, controller.signal),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => {
          controller?.abort(); reject(new Error("Saving timed out. Your changes are still here; retry saving."));
        }, options.timeoutMs ?? 15000); }),
      ]);
      if (saved.id !== id) throw new Error("The save response did not match this lesson.");
      const latest = dirty.get(id);
      if (!disposed && latest) {
        acknowledged.set(id, saved);
        options.onAcknowledged?.(saved);
        if (latest.revision === entry.revision) {
          dirty.delete(id); failed.delete(id); options.onSaved(saved);
        } else if (options.rebase) {
          latest.value = options.rebase(latest.value, saved);
        }
      }
    } catch (error) {
      if (!disposed && dirty.has(id)) { failed.add(id); options.onError(error, entry.value); }
    } finally {
      if (timeout) clearTimeout(timeout);
      controller = undefined; active = false; emit();
      // A new edit or another record may have arrived while this write waited.
      // Failed revisions stay visible but never spin in an automatic retry loop.
      if (queued.size) schedule();
    }
  }
  return {
    enqueue(value: T) { dirty.set(value.id, { revision: ++revision, value }); queued.add(value.id); failed.delete(value.id); emit(); schedule(); },
    retry() { for (const id of dirty.keys()) queued.add(id); failed.clear(); emit(); schedule(0); },
    remove(id: string) { dirty.delete(id); acknowledged.delete(id); queued.delete(id); failed.delete(id); emit(); },
    getDraft(id: string) { return dirty.get(id)?.value; },
    // An input can arrive after acknowledgement but before its UI render.
    // Keep the accepted value available without treating it as an unsaved edit.
    getAcknowledged(id: string) { return acknowledged.get(id); },
    hasDraft(id: string) { return dirty.has(id); },
    merge(server: T[]) { const merged = new Map(server.map(value => [value.id, value])); for (const [id, entry] of dirty) merged.set(id, entry.value); return [...merged.values()]; },
    dispose() { disposed = true; acknowledged.clear(); if (timer) clearTimeout(timer); controller?.abort(); },
  };
}
