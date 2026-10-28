import "server-only";
import { isWiseDraftEnabled } from "@/lib/wise-bank-transfer";

export type WisePaymentsMode = "disabled" | "draft" | "hosted";

/** Server configuration only; no public/client flag or provider-approval claim. */
export function getWisePaymentsMode(env: Readonly<Record<string, string | undefined>> = process.env): WisePaymentsMode {
  if (typeof window !== "undefined") return "disabled";
  if (isWiseDraftEnabled(env)) return "draft";
  if (env.ALPHA_WISE_PAYMENTS_ENABLED !== "1" || env.NODE_ENV !== "production"
    || env.ALPHA_EXCHANGE_DATA_BACKEND !== "postgres"
    || env.ALPHA_EXCHANGE_FORCE_INMEMORY_REPOSITORY === "1"
    || env.ALPHA_E2E_TEST_SUPPORT === "1" || env.ALPHA_E2E_LOOPBACK_ONLY === "1"
    || env.ALPHA_USDT_OFFLINE_PREVIEW === "1") return "disabled";
  const current = env.ALPHA_EXCHANGE_WISE_DATA_SECRET?.trim() ?? "";
  const previous = env.ALPHA_EXCHANGE_WISE_DATA_PREVIOUS_SECRET?.trim();
  if (current.length < 32 || (previous && previous.length < 32)) return "disabled";
  try {
    const connection = new URL(env.SUPABASE_DB_URL ?? env.DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(connection.protocol) || !connection.hostname) return "disabled";
  } catch { return "disabled"; }
  // Actual role, TLS, schema and connection readiness remain fail-closed in
  // the canonical repository/authentication path before any account mutation.
  return "hosted";
}

export function isWisePaymentsEnabled() {
  return getWisePaymentsMode() !== "disabled";
}
