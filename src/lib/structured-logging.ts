import { redactPhoneNumbers } from "@/lib/privacy-redaction";

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

const SECRET_FIELD_PATTERN = /token|password|secret|otp|code/i;
const FINANCIAL_OR_PHONE_FIELD_PATTERN = /phone|whatsapp|bank|account(?:number)?|iban|swift/i;

function redact(value: unknown, fieldName?: string): unknown {
  if (value == null) return value;
  if (fieldName && SECRET_FIELD_PATTERN.test(fieldName)) return "[REDACTED]";
  if (fieldName && FINANCIAL_OR_PHONE_FIELD_PATTERN.test(fieldName)) return "[REDACTED]";
  if (typeof value === "string") {
    return redactPhoneNumbers(value);
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(record)) {
      out[key] = redact(val, key);
    }
    return out;
  }
  return value;
}

export function logEvent(level: LogLevel, payload: LogPayload) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...payload,
    reason: redact(payload.reason),
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
