import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function dedicatedSecret(name: string) {
  const value = process.env[name]?.trim();
  if (value && value.length < 32) throw new Error(`${name} must contain at least 32 characters.`);
  return value;
}

function keyMaterial() {
  const current = dedicatedSecret("ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_SECRET");
  const previous = dedicatedSecret("ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_PREVIOUS_SECRET");
  const legacy = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || process.env.SUPABASE_DB_URL?.trim()
    || (process.env.NODE_ENV === "test" ? "alpha-exchange-cardless-test-secret" : "");
  if (!current && !legacy) throw new Error("Cardless credential encryption is not configured.");
  // A staged rollout lets existing deployments drain before new writes switch.
  // All staged deployments can already decrypt the new key during this period.
  const activation = process.env.ALPHA_EXCHANGE_CARDLESS_CREDENTIAL_ACTIVATE_AT?.trim();
  const activationTime = activation ? Date.parse(activation) : 0;
  if (activation && (!Number.isFinite(activationTime) || !current)) {
    throw new Error("Cardless credential key activation is invalid.");
  }
  const writingLegacy = Boolean(activation && Date.now() < activationTime);
  if (writingLegacy && !legacy) throw new Error("Legacy cardless encryption key is required during staging.");
  const write = writingLegacy ? legacy : current || legacy;
  const reads = [...new Set([
    write, current, previous, legacy,
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    process.env.SUPABASE_DB_URL?.trim(),
  ].filter((value): value is string => Boolean(value)))];
  const derive = (secret: string) => createHash("sha256").update(`alpha-exchange-cardless-v1\0${secret}`).digest();
  return { write: derive(write), reads: reads.map(derive) };
}

export function cardlessCredentialPayloadHash(requestId: string, payload: string) {
  return createHmac("sha256", keyMaterial().write).update(`cardless-code\0${requestId}\0${payload}`).digest("hex");
}

export function matchesCardlessCredentialPayloadHash(stored: string | undefined, requestId: string, payload: string) {
  if (!stored || !/^[a-f0-9]{64}$/.test(stored)) return false;
  const expected = Buffer.from(stored, "hex");
  return keyMaterial().reads.some((key) => timingSafeEqual(
    expected, createHmac("sha256", key).update(`cardless-code\0${requestId}\0${payload}`).digest(),
  ));
}

export function encryptCardlessCredential(payload: string, requestId: string, messageId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial().write, iv);
  cipher.setAAD(Buffer.from(`${requestId}\0${messageId}`));
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  return `cardless:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptCardlessCredential(value: string, requestId: string, messageId: string) {
  const parts = value.split(":");
  const [prefix, version, ivValue, tagValue, encryptedValue] = parts;
  if (parts.length !== 5 || prefix !== "cardless" || version !== "v1"
    || !ivValue || !tagValue || !encryptedValue
    || ![ivValue, tagValue, encryptedValue].every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  if (iv.length !== 12 || tag.length !== 16) return null;
  for (const key of keyMaterial().reads) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from(`${requestId}\0${messageId}`));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
    } catch {
      // A bounded server-owned key ring supports pre-migration ciphertext.
    }
  }
  return null;
}
