type LogLevel = "info" | "warn" | "error";

type LogPayload = {
  event: string;
  actorUserId?: string;
  actorRole?: string;
  targetUserId?: string;
  resourceId?: string;
  outcome: "success" | "denied" | "failed";
  reason?: string;
  metadata?: Record<string, unknown>;
};

function redact(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    if (/token|password|secret|otp|code/i.test(value)) return "[REDACTED]";
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(record)) {
      out[key] = /token|password|secret|otp|code/i.test(key) ? "[REDACTED]" : redact(val);
    }
    return out;
  }
  return value;
}

export function logEvent(level: LogLevel, payload: LogPayload) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...payload,
    metadata: redact(payload.metadata ?? {}),
  };
  if (level === "error") {
    console.error("[structured-log]", entry);
    return;
  }
  if (level === "warn") {
    console.warn("[structured-log]", entry);
    return;
  }
  console.info("[structured-log]", entry);
}
