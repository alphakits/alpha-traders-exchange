const OFFICIAL_WHATSAPP_HOSTS = new Set(["wa.me", "api.whatsapp.com"]);

export function getOfficialOwnerWhatsAppUrl(
  value = process.env.NEXT_PUBLIC_ALPHA_OWNER_WHATSAPP_URL,
): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:"
      || !OFFICIAL_WHATSAPP_HOSTS.has(url.hostname.toLowerCase())
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
