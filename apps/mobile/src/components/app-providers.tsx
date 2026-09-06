import { useState, type PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../auth/auth-context";
import { LocaleProvider } from "../i18n/locale-context";

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
      },
    },
  }));
  return (
    <SafeAreaProvider>
      <LocaleProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>{children}</AuthProvider>
        </QueryClientProvider>
      </LocaleProvider>
    </SafeAreaProvider>
  );
}
