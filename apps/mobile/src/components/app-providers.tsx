import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { AppState } from "react-native";
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "../auth/auth-context";
import { LocaleProvider } from "../i18n/locale-context";
import { NetworkProvider } from "../network/network-context";
import { isPrivateMobileQueryKey } from "../query/private-query-cache";
import { AcademyProgressProvider } from "../academy/academy-progress-context";
import { BiometricLockProvider, useBiometricLock } from "../security/biometric-lock-context";

function NativeQueryBoundary({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const { status, user } = useAuth();
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

  return children;
}

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
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
