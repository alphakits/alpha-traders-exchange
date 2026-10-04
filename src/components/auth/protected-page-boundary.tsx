"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useCanonicalSession } from "@/components/auth/canonical-session-provider";
import { getSignedOutPageDestination, isProtectedPage } from "@/lib/protected-page";
import { phoneVerificationDestinationForPage } from "@/lib/phone-verification-page";
import type { AppLocale } from "@/i18n/routing";
import { getInterfacePageDestination } from "@alpha-traders/contracts";

export function ProtectedPageBoundary({ children, locale, phoneVerificationRequired = false }: { children: ReactNode; locale: AppLocale; phoneVerificationRequired?: boolean }) {
  const pathname = usePathname();
  const { user, isResolving, isRestoring, error, refresh } = useCanonicalSession();
  const protectedPage = isProtectedPage(pathname ?? "/");
  const renderedUserId = useRef(user?.id ?? null);
  const accountChanged = protectedPage && Boolean(user && renderedUserId.current && user.id !== renderedUserId.current);
  const roleDestination = user ? getInterfacePageDestination(user, pathname ?? "/", locale) : null;
  const phoneDestination = phoneVerificationRequired && user && user.isPhotoVerified !== true
    ? phoneVerificationDestinationForPage(user, pathname ?? "/", locale)
    : null;

  useEffect(() => {
    if (accountChanged) {
      // RSC props and private client state belong to the previous account.
      // Discard both before rendering anything under the new principal.
      window.location.replace(`${pathname}${window.location.search}${window.location.hash}`);
    } else if (user && !renderedUserId.current) {
      renderedUserId.current = user.id;
    }
  }, [accountChanged, pathname, user]);

  useEffect(() => {
    if (protectedPage && !user && !isResolving && !error) {
      // A full replacement also discards stale router data from the old session.
      window.location.replace(getSignedOutPageDestination(`${pathname}${window.location.search}${window.location.hash}`));
    }
  }, [pathname, protectedPage, user, isResolving, error]);

  useEffect(() => {
    if (!phoneDestination || isRestoring || error || !user) return;
    const destination = phoneVerificationDestinationForPage(user, `${pathname}${window.location.search}${window.location.hash}`, locale);
    if (destination) window.location.replace(destination);
  }, [phoneDestination, pathname, user, isRestoring, error, locale]);

  useEffect(() => {
    if (roleDestination && !isRestoring && !error) window.location.replace(roleDestination);
  }, [roleDestination, isRestoring, error]);

  if (!accountChanged && !phoneDestination && !roleDestination && (!protectedPage || (user && !isRestoring))) return children;
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
