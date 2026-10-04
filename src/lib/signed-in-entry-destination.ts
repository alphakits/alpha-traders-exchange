import { getInterfaceAccess, getInterfacePageDestination, type InterfaceSessionUser } from "@alpha-traders/contracts";

type EntryUser = InterfaceSessionUser & { onboardingSelection?: string; onboardingCompletedAt?: string };

export function signedInEntryDestination(locale: "ar" | "en", user: EntryUser, requested?: string) {
  const access = getInterfaceAccess(user);
  const roles = [user.role, ...(user.roles ?? [])];
  if (!user.onboardingSelection && !user.onboardingCompletedAt && roles.every((role) => role === "guest")) {
    return `/${locale}/onboarding`;
  }
  const safeRequested = requested?.startsWith("/") && !requested.startsWith("//")
    && !/[\\\u0000-\u0020]/.test(requested)
    && !/^\/(?:ar\/|en\/)?(?:login|register)(?:[/?#]|$)/.test(requested)
    ? requested : null;
  const path = safeRequested?.replace(/^\/(?:ar|en)(?=\/|[?#]|$)/, "") || access.dashboardHref;
  return getInterfacePageDestination(user, path, locale) ?? `/${locale}${path}`;
}
