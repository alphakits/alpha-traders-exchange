"use client";

import "./globals.css";
import { useEffect } from "react";
import Link from "next/link";
import { ShieldAlert, RefreshCcw, Home } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error.message, error.digest);
  }, [error]);

  return (
    <html suppressHydrationWarning>
      <body className="relative bg-[#0B0B0B] text-white antialiased">
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="w-full max-w-lg">
            <div className="surface-panel-subtle relative overflow-hidden p-8 text-center shadow-2xl backdrop-blur-sm md:p-10">
              {/* Radial glow */}
              <div
                className="pointer-events-none absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-[#C9A227]/10 blur-3xl"
                aria-hidden="true"
              />

              {/* Icon */}
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-[#C9A227]/25 bg-[#C9A227]/10">
                <ShieldAlert className="h-10 w-10 text-[#C9A227]" aria-hidden="true" />
              </div>

              {/* Title */}
              <h1 className="text-2xl font-semibold text-white md:text-3xl">
                Something went wrong
              </h1>

              {/* Description */}
              <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-white/50">
                A critical error occurred. Please try again — if the issue persists,
                refresh the page or return home.
              </p>

              {/* Divider */}
              <div className="mx-auto my-6 h-px w-24 bg-[#C9A227]/20" aria-hidden="true" />

              {/* Buttons */}
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={reset}
                  className={buttonVariants()}
                >
                  <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                  Try Again
                </button>
                <Link
                  href="/"
                  className={cn(buttonVariants({ variant: "secondary" }))}
                >
                  <Home className="h-4 w-4" aria-hidden="true" />
                  Home
                </Link>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
