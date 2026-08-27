import type { AppLocale } from "@/i18n/routing";

/**
 * Kept as a no-op for source compatibility with any stale imports.
 * Browser push is intentionally unavailable until the complete service-worker,
 * PushManager subscription, VAPID sender, and delivery pipeline exist.
 */
export function BrowserPushPrompt(_props: { locale: AppLocale }) {
  void _props;
  return null;
}
