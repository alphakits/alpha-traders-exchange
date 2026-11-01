"use client";

import { useEffect, useState } from "react";
import { ErrorContent } from "@/components/errors/error-content";
import { reloadCurrentPage } from "@/lib/page-recovery";
import { reportClientError } from "@/lib/report-client-error";

export default function LocaleError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [reference, setReference] = useState<string>();
  useEffect(() => {
    setReference(reportClientError(error, "locale"));
  }, [error]);

  return <ErrorContent reset={reloadCurrentPage} reference={reference} />;
}
