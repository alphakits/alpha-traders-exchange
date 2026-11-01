"use client";
import { useEffect, useSyncExternalStore } from "react";
import { deriveUserPresence, PRESENCE_POLL_MS, type UserPresenceData } from "@alpha-traders/contracts";

const listeners = new Set<() => void>();
const watched = new Map<string, number>();
let values: Record<string, UserPresenceData> = {};
const emptySnapshot: Record<string, UserPresenceData> = {};
let timer: ReturnType<typeof setInterval> | undefined;
let pending = false;
let pollAgain = false;
let queuedPoll: ReturnType<typeof setTimeout> | undefined;
let serverOffset = 0;
let generation = 0;
const emit = () => { values = { ...values }; for (const listener of listeners) listener(); };

async function poll() {
  if (pending) { pollAgain = true; return; }
  if (document.visibilityState === "hidden" || navigator.onLine === false) { emit(); return; }
  const ids = [...watched.keys()];
  if (!ids.length) return;
  pending = true;
  const requestGeneration = generation;
  try {
    // One batched request for every visible card/profile, never one per card.
    for (let start = 0; start < ids.length; start += 100) {
      const batch = ids.slice(start, start + 100);
      const response = await fetch(`/api/alpha-exchange/presence?ids=${encodeURIComponent(batch.join(","))}`, { credentials: "include", cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) continue;
      const body = await response.json() as { users?: Record<string, UserPresenceData>; serverTime?: string };
      if (!body.users || requestGeneration !== generation) continue;
      const serverTime = Date.parse(body.serverTime ?? "");
      if (Number.isFinite(serverTime)) serverOffset = serverTime - Date.now();
      values = { ...values, ...Object.fromEntries(batch.map(id => [id, body.users![id] ?? { onlineStatus: "offline", lastActiveAt: null, lastSeenAt: null }])) };
    }
  } catch { /* The lease expires locally; a failed request cannot keep anyone green. */ }
  finally { pending = false; emit(); if ((pollAgain || requestGeneration !== generation) && watched.size) { pollAgain = false; queuePoll(); } }
}

function queuePoll() {
  if (queuedPoll) return;
  queuedPoll = setTimeout(() => { queuedPoll = undefined; void poll(); }, 0);
}
function resume() { queuePoll(); }
function clear() { generation += 1; values = {}; serverOffset = 0; emit(); void poll(); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => void poll(), PRESENCE_POLL_MS);
    window.addEventListener("focus", resume);
    window.addEventListener("alpha-presence-updated", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("alpha-auth-changed", clear);
    window.addEventListener("alpha-auth-signed-out", clear);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer); clearTimeout(queuedPoll); queuedPoll = undefined; timer = undefined; generation += 1; values = {};
      window.removeEventListener("focus", resume);
      window.removeEventListener("alpha-presence-updated", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("alpha-auth-changed", clear);
      window.removeEventListener("alpha-auth-signed-out", clear);
    }
  };
}

export function useLiveUserPresence(userId: string | undefined, initial: UserPresenceData = {}) {
  const snapshot = useSyncExternalStore(subscribe, () => values, () => emptySnapshot);
  useEffect(() => {
    if (!userId) return;
    watched.set(userId, (watched.get(userId) ?? 0) + 1);
    queuePoll();
    return () => {
      const count = (watched.get(userId) ?? 1) - 1;
      if (count > 0) watched.set(userId, count); else { watched.delete(userId); delete values[userId]; }
    };
  }, [userId]);
  const value = (userId && snapshot[userId]) || initial;
  return { ...value, ...deriveUserPresence(value, Date.now() + serverOffset) };
}

export function useLivePresenceMap(userIds: string[]) {
  const snapshot = useSyncExternalStore(subscribe, () => values, () => emptySnapshot);
  const key = [...new Set(userIds)].sort().join(",");
  useEffect(() => {
    const ids = key ? key.split(",") : [];
    ids.forEach(id => watched.set(id, (watched.get(id) ?? 0) + 1));
    queuePoll();
    return () => {
      ids.forEach(id => {
        const count = (watched.get(id) ?? 1) - 1;
        if (count > 0) watched.set(id, count); else { watched.delete(id); delete values[id]; }
      });
    };
  }, [key]);
  return snapshot;
}
