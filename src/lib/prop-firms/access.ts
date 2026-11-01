import "server-only";
import { redirect } from "next/navigation";
import { getCurrentSessionUser } from "@/lib/auth";
import { getSignedOutPageDestination } from "@/lib/protected-page";

export type PropFirmSearchParams = Record<string, string | string[] | undefined>;

// Cookie presence in middleware is only an early guest check. Resolve the
// actual session before a page serializes any guide data for the client.
export async function requirePropFirmSession(locale: "ar" | "en", firm?: string, search: PropFirmSearchParams = {}) {
  const user = await getCurrentSessionUser();
  if (user) return;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, entry);
  }
  const path = `/${locale}/prop-firms${firm ? `/${encodeURIComponent(firm)}` : ""}`;
  redirect(getSignedOutPageDestination(`${path}${query.size ? `?${query}` : ""}`));
}
