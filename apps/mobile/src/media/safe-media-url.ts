/** Accept only absolute, credential-free HTTPS URLs for native remote images. */
export function safeRemoteImageUrl(value: string | null | undefined) {
  const candidate = value?.trim() ?? "";
  if (!candidate || candidate.length > 2_048) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}
