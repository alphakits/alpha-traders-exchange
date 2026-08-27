export type SupportedRequestLocale = "ar" | "en";

function localeFromReferer(referer: string | null) {
  if (!referer) return null;
  try {
    const segment = new URL(referer).pathname.split("/").filter(Boolean)[0]?.toLowerCase();
    return segment === "ar" || segment === "en" ? segment : null;
  } catch {
    return null;
  }
}

export function resolveSupportedRequestLocale(
  headers: Headers,
  defaultLocale: SupportedRequestLocale = "en",
): SupportedRequestLocale {
  const explicit = headers.get("x-locale")?.trim().toLowerCase();
  if (explicit === "ar" || explicit === "en") return explicit;

  // A localized page is an explicit user choice and must not be overridden by
  // the browser's language preferences. This also preserves the selected page
  // locale for normal same-origin form requests when an older client does not
  // yet send X-Locale.
  const pageLocale = localeFromReferer(headers.get("referer"));
  if (pageLocale) return pageLocale;

  const candidates = (headers.get("accept-language") ?? "")
    .split(",")
    .map((entry, index) => {
      const [rawTag, ...rawParams] = entry.trim().split(";");
      const base = rawTag.trim().toLowerCase().split("-")[0];
      const qualityParam = rawParams.find((param) => param.trim().toLowerCase().startsWith("q="));
      const quality = qualityParam ? Number(qualityParam.trim().slice(2)) : 1;
      return { base, quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((candidate) => (candidate.base === "ar" || candidate.base === "en") && candidate.quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  const preferred = candidates[0]?.base;
  if (preferred === "ar" || preferred === "en") return preferred;
  return defaultLocale;
}
