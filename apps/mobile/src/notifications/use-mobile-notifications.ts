import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { MobileLocale } from "@alpha-traders/contracts";
import { getMobileNotifications } from "../api/mobile-api";
import { useAuth } from "../auth/auth-context";
import { useLocale } from "../i18n/locale-context";
import { mergeUniquePages, nextPageOffset } from "../query/paged-data";

export function mobileNotificationsQueryKey(userId: string, locale: MobileLocale) {
  return ["mobile-notifications", userId, locale] as const;
}

export function useMobileNotifications() {
  const { status, user, requestWithSession } = useAuth();
  const { locale } = useLocale();
  const userId = user?.id ?? "anonymous";
  const query = useInfiniteQuery({
    enabled: status === "authenticated" && Boolean(user),
    queryKey: mobileNotificationsQueryKey(userId, locale),
    queryFn: ({ pageParam, signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileNotifications(tokens, requestLocale, pageParam, signal)),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      nextPageOffset(lastPage.pagination, allPages.length),
    refetchInterval: 10_000,
    refetchOnMount: "always",
    staleTime: 2_000,
  });
  const notifications = useMemo(
    () => mergeUniquePages(query.data?.pages.map((page) => page.notifications) ?? []),
    [query.data],
  );
  return {
    ...query,
    notifications,
    unreadCount: query.data?.pages[0]?.unreadCount ?? 0,
  };
}
