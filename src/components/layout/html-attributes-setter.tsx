"use client";
import { useEffect } from "react";

/**
 * Sets `lang` and `dir` on the root `<html>` element so each locale gets
 * correct attributes without nesting a second `<html>` inside the root layout.
 * Uses suppressHydrationWarning on the root html/body to suppress the mismatch
 * between the initial render (neutral) and the client-applied attributes.
 */
export function HtmlAttributesSetter({
  lang,
  dir,
}: {
  lang: string;
  dir: "ltr" | "rtl";
}) {
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  return null;
}
