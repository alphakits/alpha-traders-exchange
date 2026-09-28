"use client";

import { useEffect } from "react";
import { ErrorContent } from "@/components/errors/error-content";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error("[academy-error]", error.message); }, [error]);
  return <ErrorContent reset={reset} titleEn="Something went wrong in Alpha Academy" titleAr="حدث خطأ في أكاديمية ألفا" />;
}

