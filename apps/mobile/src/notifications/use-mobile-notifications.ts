import { useQuery } from "@tanstack/react-query";
import type { MobileLocale } from "@alpha-traders/contracts";
import { getMobileNotifications } from "../api/mobile-api";
import { useAuth } from "../auth/auth-context";
import { useLocale } from "../i18n/locale-context";

export function mobileNotificationsQueryKey(userId: string, locale: MobileLocale) {
  return ["mobile-notifications", userId, locale] as const;
}

export function useMobileNotifications() {
  const { status, user, requestWithSession } = useAuth();
  const { locale } = useLocale();
  const userId = user?.id ?? "anonymous";
  return useQuery({
    enabled: status === "authenticated" && Boolean(user),
    queryKey: mobileNotificationsQueryKey(userId, locale),
    queryFn: ({ signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileNotifications(tokens, requestLocale, signal)),
    refetchInterval: 10_000,
    refetchOnMount: "always",
    staleTime: 2_000,
  });
}
