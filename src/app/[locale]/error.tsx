"use client";

import { useEffect } from "react";
import { ErrorContent } from "@/components/errors/error-content";

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[locale-error]", error.message, error.digest);
  }, [error]);

  return <ErrorContent reset={reset} />;
}
