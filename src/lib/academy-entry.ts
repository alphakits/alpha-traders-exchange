/** Carry only the free Academy intent through account creation, never a supplied URL. */
export function isAcademyEntry(value: unknown): boolean {
  return typeof value === "string" && /^\/(?:ar\/|en\/)?academy(?:[/?#]|$)/.test(value);
}

export function academyLoginPath(locale: "en" | "ar") {
  return `/${locale}/login?${new URLSearchParams({ redirectTo: `/${locale}/academy` })}`;
}
