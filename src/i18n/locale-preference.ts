// Separate from next-intl's legacy cookie, which also stored inferred locales.
export const LOCALE_CHOICE_COOKIE = "ALPHA_LOCALE_CHOICE";
// Keep the choice across reloads/app resumes, bounded by the longest login.
// Successful login and logout explicitly clear it for the next session.
export const LOCALE_CHOICE_MAX_AGE = 60 * 60 * 24 * 14;

export function clearClientLocaleChoice() {
  try {
    document.cookie = `${LOCALE_CHOICE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
  } catch {
    // Language storage must never prevent sign-in, sign-out or navigation.
  }
}

export function englishLocalePath(path: string) {
  return path.replace(/^\/(?:ar|en)(?=\/|[?#]|$)/, "/en");
}
