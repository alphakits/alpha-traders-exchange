type LoginTraceMetaValue = string | number | boolean | null;

export type LoginJourneyStep = {
  name: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  meta?: Record<string, LoginTraceMetaValue>;
};

export type LoginJourneyTrace = {
  traceId: string;
  startedAt: number;
  completedAt?: number;
  steps: LoginJourneyStep[];
  apiCallCounts: Record<string, number>;
};

const TRACE_KEY = "alpha-login-journey-trace-v1";
const REDIRECT_START_KEY = "alpha-login-journey-redirect-start-v1";
const TRACE_ENABLED_QUERY = "traceLogin=1";

function canUseBrowserStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function nowMs() {
  return Date.now();
}

function safeReadTrace(): LoginJourneyTrace | null {
  if (!canUseBrowserStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(TRACE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LoginJourneyTrace;
  } catch {
    return null;
  }
}

function safeWriteTrace(trace: LoginJourneyTrace) {
  if (!canUseBrowserStorage()) return;
  try {
    window.sessionStorage.setItem(TRACE_KEY, JSON.stringify(trace));
    (window as Window & { __alphaLoginJourneyTrace?: LoginJourneyTrace }).__alphaLoginJourneyTrace = trace;
  } catch {
    // Best effort telemetry.
  }
}

function randomTraceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `trace-${nowMs()}-${Math.random().toString(16).slice(2)}`;
}

export function isLoginJourneyTraceEnabled() {
  if (typeof window === "undefined") return false;
  if (process.env.NODE_ENV !== "production") return true;
  return window.location.search.includes(TRACE_ENABLED_QUERY);
}

export function beginLoginJourney(traceId = randomTraceId()) {
  if (!isLoginJourneyTraceEnabled()) return;
  const startedAt = nowMs();
  safeWriteTrace({
    traceId,
    startedAt,
    steps: [],
    apiCallCounts: {},
  });
}

export function appendLoginJourneyStep(
  name: string,
  startTime: number,
  endTime: number,
  meta?: Record<string, LoginTraceMetaValue>,
) {
  if (!isLoginJourneyTraceEnabled()) return;
  const trace = safeReadTrace();
  if (!trace) return;
  const step: LoginJourneyStep = {
    name,
    startTime,
    endTime,
    durationMs: Math.max(0, endTime - startTime),
    meta,
  };
  trace.steps.push(step);
  trace.completedAt = endTime;
  safeWriteTrace(trace);
}

export function appendLoginJourneyServerTimeline(headerValue: string | null | undefined) {
  if (!isLoginJourneyTraceEnabled() || !headerValue) return;
  try {
    const timeline = JSON.parse(headerValue) as Array<{
      name: string;
      startTime: number;
      endTime: number;
      durationMs: number;
      meta?: Record<string, LoginTraceMetaValue>;
    }>;
    for (const step of timeline) {
      appendLoginJourneyStep(step.name, step.startTime, step.endTime, step.meta);
    }
  } catch {
    // Ignore malformed timing payloads.
  }
}

export function incrementLoginJourneyApiCall(path: string) {
  if (!isLoginJourneyTraceEnabled()) return;
  const trace = safeReadTrace();
  if (!trace) return;
  const normalized = path.split("?")[0] || path;
  trace.apiCallCounts[normalized] = (trace.apiCallCounts[normalized] ?? 0) + 1;
  safeWriteTrace(trace);
}

export function noteLoginJourneyRedirectStart(timestamp = nowMs()) {
  if (!isLoginJourneyTraceEnabled() || !canUseBrowserStorage()) return;
  try {
    window.sessionStorage.setItem(REDIRECT_START_KEY, String(timestamp));
  } catch {
    // Best effort telemetry.
  }
}

export function finalizeLoginJourneyRedirectEnd(timestamp = nowMs()) {
  if (!isLoginJourneyTraceEnabled() || !canUseBrowserStorage()) return;
  try {
    const raw = window.sessionStorage.getItem(REDIRECT_START_KEY);
    if (!raw) return;
    const start = Number(raw);
    if (Number.isFinite(start)) {
      appendLoginJourneyStep("Browser redirect", start, timestamp);
    }
    window.sessionStorage.removeItem(REDIRECT_START_KEY);
  } catch {
    // Best effort telemetry.
  }
}

export function readLoginJourneyTrace() {
  return safeReadTrace();
}
