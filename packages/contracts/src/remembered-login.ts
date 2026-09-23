export type RememberedLogin = { email: string; password: string };

export type RememberedLoginRequest = {
  type: "alpha.web.remembered-login";
  version: 1;
  requestId: string;
} & ({ action: "load" | "clear" } | { action: "save"; credentials: RememberedLogin });

export type RememberedLoginResponse = {
  type: "alpha.native.remembered-login";
  version: 1;
  requestId: string;
  status: "ok" | "failed";
  credentials?: RememberedLogin | null;
};

function record(raw: unknown): Record<string, unknown> | null {
  try {
    const value: unknown = typeof raw === "string" && raw.length <= 4096 ? JSON.parse(raw) : raw;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

export function parseRememberedLogin(raw: unknown): RememberedLogin | null {
  const value = record(raw);
  if (!value || typeof value.email !== "string" || typeof value.password !== "string") return null;
  const email = value.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !value.password || value.password.length > 256) return null;
  // Password whitespace is significant and must survive a save/load round trip.
  return { email, password: value.password };
}

export function parseRememberedLoginRequest(raw: unknown): RememberedLoginRequest | null {
  const value = record(raw);
  if (!value || value.type !== "alpha.web.remembered-login" || value.version !== 1
    || typeof value.requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(value.requestId)) return null;
  const base = { type: "alpha.web.remembered-login", version: 1, requestId: value.requestId } as const;
  if (value.action === "load" || value.action === "clear") return { ...base, action: value.action };
  const credentials = parseRememberedLogin(value.credentials);
  return value.action === "save" && credentials ? { ...base, action: "save", credentials } : null;
}

export function parseRememberedLoginResponse(raw: unknown): RememberedLoginResponse | null {
  const value = record(raw);
  if (!value || value.type !== "alpha.native.remembered-login" || value.version !== 1
    || typeof value.requestId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(value.requestId)
    || (value.status !== "ok" && value.status !== "failed")) return null;
  const credentials = value.credentials == null ? value.credentials : parseRememberedLogin(value.credentials);
  if (value.credentials != null && !credentials) return null;
  return { type: "alpha.native.remembered-login", version: 1, requestId: value.requestId, status: value.status,
    ...(credentials !== undefined ? { credentials: credentials as RememberedLogin | null } : {}) };
}
