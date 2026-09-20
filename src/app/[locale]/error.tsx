"use client";

import { useEffect } from "react";
import { ErrorContent } from "@/components/errors/error-content";
import { reloadCurrentPage } from "@/lib/page-recovery";

export default function LocaleError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[locale-error]", error.message, error.digest);
  }, [error]);

  return <ErrorContent reset={reloadCurrentPage} />;
}
