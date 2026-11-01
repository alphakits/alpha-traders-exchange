/** Carry only the free Academy intent through account creation, never a supplied URL. */
export function isAcademyEntry(value: unknown): boolean {
  return typeof value === "string" && /^\/(?:ar\/|en\/)?academy(?:[/?#]|$)/.test(value);
}

export function academyLoginPath(locale: "en" | "ar") {
  return `/${locale}/login?${new URLSearchParams({ redirectTo: `/${locale}/academy` })}`;
}

/** A fixed mentorship intent keeps registration return URLs on our own site. */
export function isMentorshipEntry(value: unknown): boolean {
  return typeof value === "string" && /^\/(?:ar\/|en\/)?learn-with-mark(?:[/?#]|$)/.test(value);
}

export function mentorshipLoginPath(locale: "en" | "ar") {
  return `/${locale}/login?${new URLSearchParams({ redirectTo: `/${locale}/learn-with-mark` })}`;
}
