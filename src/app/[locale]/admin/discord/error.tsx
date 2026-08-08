"use client";

import { useEffect } from "react";

import { ErrorContent } from "@/components/errors/error-content";

export default function DiscordManagementError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[discord-management-error]", error.name);
  }, [error]);
  return (
    <ErrorContent
      reset={reset}
      titleEn="Discord Management could not be loaded"
      titleAr="تعذر تحميل إدارة ديسكورد"
    />
  );
}
