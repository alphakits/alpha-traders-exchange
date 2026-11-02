"use client";

import { useEffect, useRef, useTransition, type ReactNode } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";

export function MentorshipLink({ href, locale, replace = false, className, children }: {
  href: string;
  locale: AppLocale;
  replace?: boolean;
  className: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const destination = useRef<string | null>(null);

  useEffect(() => {
    if (!pending) destination.current = null;
  }, [pending, href]);

  return (
    <Link href={href} locale={locale} replace={replace} prefetch={false} className={className}
      aria-busy={pending || undefined}
      onNavigate={event => {
        // The existing section navigator owns same-page focus and scrolling.
        if (href.includes("#")) return;
        event.preventDefault();
        if (destination.current === href) return;
        // Capture the intent synchronously, including taps before React paints.
        // A completed or cancelled transition makes the link usable again.
        destination.current = href;
        startTransition(() => {
          if (replace) router.replace(href, { locale });
          else router.push(href, { locale });
        });
      }}>
      {children}
    </Link>
  );
}
