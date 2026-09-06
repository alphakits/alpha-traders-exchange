import { useQuery } from "@tanstack/react-query";
import { getMobileAcademy, getMobileAcademyLesson } from "../api/mobile-api";
import { useAuth } from "../auth/auth-context";
import { useLocale } from "../i18n/locale-context";
import { useNetworkStatus } from "../network/network-context";
import {
  loadAcademyCatalogWithFallback,
  loadAcademyLessonWithFallback,
} from "./academy-content-cache";

const ACADEMY_STALE_TIME_MS = 5 * 60 * 1_000;
const ACADEMY_GC_TIME_MS = 24 * 60 * 60 * 1_000;

export function useAcademyCatalog() {
  const { status, user, requestWithSession } = useAuth();
  const { locale } = useLocale();
  const { isOnline } = useNetworkStatus();
  const userId = user?.id ?? "anonymous";
  return useQuery({
    queryKey: ["mobile-academy", userId, locale],
    enabled: status === "authenticated" && Boolean(user),
    queryFn: ({ signal }) => loadAcademyCatalogWithFallback(
      userId,
      () => requestWithSession((tokens, requestLocale) => getMobileAcademy(tokens, requestLocale, signal)),
      signal,
      isOnline,
    ),
    networkMode: "always",
    staleTime: ACADEMY_STALE_TIME_MS,
    gcTime: ACADEMY_GC_TIME_MS,
  });
}

export function useAcademyLesson(slug: string) {
  const { status, user, requestWithSession } = useAuth();
  const { locale } = useLocale();
  const { isOnline } = useNetworkStatus();
  const userId = user?.id ?? "anonymous";
  return useQuery({
    queryKey: ["mobile-academy-lesson", userId, slug, locale],
    enabled: status === "authenticated" && Boolean(user) && Boolean(slug),
    queryFn: ({ signal }) => loadAcademyLessonWithFallback(
      userId,
      slug,
      () => requestWithSession((tokens, requestLocale) => getMobileAcademyLesson(tokens, requestLocale, slug, signal)),
      signal,
      isOnline,
    ),
    networkMode: "always",
    staleTime: ACADEMY_STALE_TIME_MS,
    gcTime: ACADEMY_GC_TIME_MS,
  });
}
