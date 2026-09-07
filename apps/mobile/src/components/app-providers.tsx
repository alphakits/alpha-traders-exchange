import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { AppState, InteractionManager } from "react-native";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../auth/auth-context";
import { LocaleProvider, useLocale } from "../i18n/locale-context";
import { NetworkProvider } from "../network/network-context";
import { isPrivateMobileQueryKey } from "../query/private-query-cache";
import { AcademyProgressProvider } from "../academy/academy-progress-context";
import { BiometricLockProvider, useBiometricLock } from "../security/biometric-lock-context";
import {
  getMobileAccountProfile,
  getMobileMarketplace,
  getMobileTrades,
  getPublicMarketSnapshot,
} from "../api/mobile-api";
import { nextPageOffset } from "../query/paged-data";

function NativeQueryBoundary({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const { status, user, requestWithSession } = useAuth();
  const { locale } = useLocale();
  const { isLocked } = useBiometricLock();
  const previousUserId = useRef<string | null>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    focusManager.setFocused(AppState.currentState === "active" && !isLocked);
    const subscription = AppState.addEventListener("change", (nextState) => {
      focusManager.setFocused(nextState === "active" && !isLocked);
    });
    return () => {
      subscription.remove();
      focusManager.setFocused(undefined);
    };
  }, [isLocked]);

  useEffect(() => {
    const nextUserId = status === "authenticated" ? userId : null;
    if (status !== "authenticated" && status !== "anonymous") return;
    if (previousUserId.current === nextUserId) return;
    queryClient.removeQueries({
      predicate: (query) => isPrivateMobileQueryKey(query.queryKey),
    });
    previousUserId.current = nextUserId;
  }, [queryClient, status, userId]);

  useEffect(() => {
    if (status !== "authenticated" || !user) return undefined;
    const task = InteractionManager.runAfterInteractions(() => {
      void Promise.allSettled([
        queryClient.prefetchInfiniteQuery({
          queryKey: ["mobile-marketplace", user.id, locale, "all", "all", "all", false, "trust-desc"],
          queryFn: ({ pageParam, signal }) => requestWithSession((tokens, requestLocale) =>
            getMobileMarketplace(requestLocale, Number(pageParam), signal, { sort: "trust-desc" }, tokens)),
          initialPageParam: 0,
          getNextPageParam: (
            lastPage: Awaited<ReturnType<typeof getMobileMarketplace>>,
            allPages: Array<Awaited<ReturnType<typeof getMobileMarketplace>>>,
          ) => nextPageOffset(lastPage.pagination, allPages.length),
          staleTime: 20_000,
        }),
        queryClient.prefetchInfiniteQuery({
          queryKey: ["mobile-trades", user.id, locale],
          queryFn: ({ pageParam, signal }) => requestWithSession((tokens, requestLocale) =>
            getMobileTrades(tokens, requestLocale, Number(pageParam), signal)),
          initialPageParam: 0,
          getNextPageParam: (
            lastPage: Awaited<ReturnType<typeof getMobileTrades>>,
            allPages: Array<Awaited<ReturnType<typeof getMobileTrades>>>,
          ) => nextPageOffset(lastPage.pagination, allPages.length),
          staleTime: 15_000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["mobile-profile", user.id, locale],
          queryFn: ({ signal }) => requestWithSession((tokens, requestLocale) =>
            getMobileAccountProfile(tokens, requestLocale, signal)),
          staleTime: 30_000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["public-market-center", locale],
          queryFn: ({ signal }) => getPublicMarketSnapshot(locale, signal),
          staleTime: 30_000,
        }),
      ]);
    });
    return () => task.cancel();
  }, [locale, queryClient, requestWithSession, status, user]);

  return children;
}

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 30 * 60_000,
        retry: 1,
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
      },
    },
  }));
  return (
    <SafeAreaProvider>
      <LocaleProvider>
        <NetworkProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <BiometricLockProvider>
                <AcademyProgressProvider>
                  <NativeQueryBoundary>{children}</NativeQueryBoundary>
                </AcademyProgressProvider>
              </BiometricLockProvider>
            </AuthProvider>
          </QueryClientProvider>
        </NetworkProvider>
      </LocaleProvider>
    </SafeAreaProvider>
  );
}
