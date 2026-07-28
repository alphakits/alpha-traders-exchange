"use client";

import { useEffect } from "react";
import { ErrorContent } from "@/components/errors/error-content";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error("[profile-error]", error.message); }, [error]);
  return <ErrorContent reset={reset} titleEn="Something went wrong loading your profile" titleAr="حدث خطأ أثناء تحميل ملفك الشخصي" />;
}
