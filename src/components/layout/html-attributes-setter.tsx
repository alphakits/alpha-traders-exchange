"use client";
import { useEffect } from "react";

/**
 * Keeps `lang` and `dir` on the root `<html>` element synchronized after
 * client-side locale navigation. The root layout sets the correct values for
 * the initial server render, but it is preserved when the locale segment changes.
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
