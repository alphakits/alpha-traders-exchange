"use client";

import { useEffect } from "react";
import { ErrorContent } from "@/components/errors/error-content";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error("[usdt-exchange-error]", error.message); }, [error]);
  return <ErrorContent reset={reset} titleEn="Something went wrong on Alpha Exchange" titleAr="حدث خطأ في ألفا إكستشينج" />;
}

