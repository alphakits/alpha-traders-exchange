import { createHash } from "node:crypto";

/** An opaque route key; real names and email aliases must never resolve publicly. */
export function publicAccountUsername(id: string | undefined) {
  const value = String(id ?? "").trim();
  return value ? `seller-${createHash("sha256").update(value).digest("hex").slice(0, 8)}` : "seller";
}
