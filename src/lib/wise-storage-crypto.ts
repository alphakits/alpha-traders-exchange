import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { isProductionSecurityRuntime } from "@/lib/runtime-safety";

const PRIVATE_FIELDS = new Set(["wiseUsdAccounts", "buyerWiseAccountSnapshot", "sellerWiseAccountSnapshot"]);
const PREFIX = "wise-data:v1:";
const MAX_PRIVATE_BYTES = 64 * 1024;

/** Errors deliberately omit row IDs, account details, ciphertext, and key material. */
export class WiseStorageError extends Error {
  constructor() {
    super("Private Wise storage is unavailable.");
    this.name = "WiseStorageError";
  }
}

function hostedRuntime() {
  return isProductionSecurityRuntime() || Boolean(process.env.VERCEL || process.env.VERCEL_ENV
    || process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID);
}

function keys() {
  const current = process.env.ALPHA_EXCHANGE_WISE_DATA_SECRET?.trim()
    || (process.env.NODE_ENV === "test" && !hostedRuntime() ? "synthetic-wise-storage-unit-test-secret-only" : "");
  const previous = process.env.ALPHA_EXCHANGE_WISE_DATA_PREVIOUS_SECRET?.trim();
  if (current.length < 32 || (previous && previous.length < 32)) throw new WiseStorageError();
  const derive = (secret: string) => createHash("sha256").update(`alpha-exchange-wise-data-v1\0${secret}`).digest();
  return { write: derive(current), reads: [...new Set([current, previous].filter((key): key is string => Boolean(key)))].map(derive) };
}

function aad(parent: Record<string, unknown>, field: string) {
  if (typeof parent.id !== "string" || !parent.id || parent.id.includes("\0")) throw new WiseStorageError();
  return Buffer.from(`alpha-exchange-wise-data-v1\0${parent.id}\0${field}`);
}

function hasPrivateValue(field: string, value: unknown) {
  return value !== null && value !== undefined && !(field === "wiseUsdAccounts" && Array.isArray(value) && value.length === 0);
}

function validPlainValue(field: string, value: unknown) {
  return field === "wiseUsdAccounts" ? Array.isArray(value) && value.length <= 2
    : typeof value === "object" && value !== null && !Array.isArray(value);
}

function encrypt(value: unknown, parent: Record<string, unknown>, field: string) {
  if (!validPlainValue(field, value)) throw new WiseStorageError();
  const plaintext = Buffer.from(JSON.stringify(value));
  if (plaintext.length > MAX_PRIVATE_BYTES) throw new WiseStorageError();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys().write, iv);
  cipher.setAAD(aad(parent, field));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return `${PREFIX}${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decrypt(value: string, parent: Record<string, unknown>, field: string) {
  if (!value.startsWith(PREFIX) || value.length > MAX_PRIVATE_BYTES * 2) throw new WiseStorageError();
  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new WiseStorageError();
  const [iv, tag, ciphertext] = parts.map(part => Buffer.from(part, "base64url"));
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_PRIVATE_BYTES
    || parts.some((part, index) => [iv, tag, ciphertext][index].toString("base64url") !== part)) throw new WiseStorageError();
  const context = aad(parent, field);
  for (const key of keys().reads) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(context);
      decipher.setAuthTag(tag);
      const decoded: unknown = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
      if (!validPlainValue(field, decoded)) throw new WiseStorageError();
      return decoded;
    } catch { /* A bounded current/previous key ring permits staged key rotation. */ }
  }
  throw new WiseStorageError();
}

/** Entity fields, aggregate snapshots, and audit entity copies share one scope. */
function transformWiseStorage<T>(value: T, direction: "encode" | "decode"): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const next = value.map(entry => transformWiseStorage(entry, direction));
    return (next.some((entry, index) => entry !== value[index]) ? next : value) as T;
  }
  const row = value as Record<string, unknown>;
  let result = row;
  // Avoid walking each ordinary message/timeline on a read or write. Audit
  // entity copies are explicitly covered; current Wise audits contain last4 only.
  const entity = typeof row.id === "string";
  const entries = entity
    ? [...PRIVATE_FIELDS, "oldValue", "newValue"].filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]] as const)
    : Object.entries(row);
  for (const [field, entry] of entries) {
    let decoded = entry;
    if (entity && PRIVATE_FIELDS.has(field) && hasPrivateValue(field, entry)) {
      if (direction === "encode") decoded = encrypt(entry, row, field);
      else if (typeof entry === "string") decoded = decrypt(entry, row, field);
      else if (hostedRuntime() || !validPlainValue(field, entry)) throw new WiseStorageError();
    } else if (entry && typeof entry === "object") decoded = transformWiseStorage(entry, direction);
    if (decoded !== entry) {
      if (result === row) result = { ...row };
      result[field] = decoded;
    }
  }
  return result as T;
}

/** Persist encrypted entity fields without a per-property JSON replacer cost. */
export function serializeWiseStorageJson(value: unknown): string {
  return JSON.stringify(transformWiseStorage(value, "encode"));
}

/** Copy only changed branches. Non-Wise entities need no key and retain their shape. */
export function decodeWiseStorage<T>(value: T): T {
  return transformWiseStorage(value, "decode");
}
