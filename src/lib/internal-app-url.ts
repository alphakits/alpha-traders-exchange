export const APP_DESTINATION_ORIGIN = "https://www.alphatraders.co.il";

/** Parse application links without allowing another origin or executable URLs. */
export function parseInternalAppUrl(href: string | null | undefined, origin = APP_DESTINATION_ORIGIN): URL | null {
  const value = href?.trim();
  if (!value || value.startsWith("//")) return null;
  if (!value.startsWith("/") && !/^https?:\/\//i.test(value)) return null;
  if ([...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "\\")) return null;
  try {
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin || parsed.username || parsed.password) return null;
    // URL accepts broken percent escapes, but route decoding can throw on them.
    decodeURI(`${parsed.pathname}${parsed.search}${parsed.hash}`);
    return parsed;
  } catch {
    return null;
  }
}
