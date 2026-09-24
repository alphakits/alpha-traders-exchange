"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useCanonicalSession } from "@/components/auth/canonical-session-provider";
import { getSignedOutPageDestination, isProtectedPage } from "@/lib/protected-page";
import type { AppLocale } from "@/i18n/routing";

export function ProtectedPageBoundary({ children, locale }: { children: ReactNode; locale: AppLocale }) {
  const pathname = usePathname();
  const { user, isResolving, isRestoring, error, refresh } = useCanonicalSession();
  const protectedPage = isProtectedPage(pathname ?? "/");

  useEffect(() => {
    if (protectedPage && !user && !isResolving && !error) {
      // A full replacement also discards stale router data from the old session.
      window.location.replace(getSignedOutPageDestination(`${pathname}${window.location.search}${window.location.hash}`));
    }
  }, [pathname, protectedPage, user, isResolving, error]);

  if (!protectedPage || (user && !isRestoring)) return children;
  // Never mount account components with an anonymous or unresolved principal.
  // A network outage is recoverable and must not be mistaken for a logout.
  return (
    <section className="section-container py-16 text-center" aria-busy={isResolving}>
      <p role="status">{error
        ? (locale === "ar" ? "تعذّر التحقق من حسابك مؤقتًا." : "Your account could not be verified. Please try again.")
        : (locale === "ar" ? "جارٍ التحقق من حسابك…" : "Checking your account…")}</p>
      {error ? (
        <button type="button" className="mt-4 underline" onClick={() => void refresh({ force: true })}>
          {locale === "ar" ? "حاول مرة أخرى" : "Try again"}
        </button>
      ) : null}
    </section>
  );
}
