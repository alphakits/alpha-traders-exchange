import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSiteUrl } from "@/lib/site-url";

type Locale = "ar" | "en";

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

function getSupabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
}

export function createSupabaseAuthClient() {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) {
    throw new Error("Supabase authentication is not configured.");
  }
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function inferLocaleFromRequest(request: NextRequest): Locale {
  const referer = request.headers.get("referer");
  if (!referer) return "en";
  try {
    const pathname = new URL(referer).pathname;
    if (/^\/ar(?:\/|$)/.test(pathname)) return "ar";
  } catch {
    return "en";
  }
  return "en";
}

export function getSupabaseEmailRedirectUrl(locale: Locale) {
  return `${getSiteUrl()}/${locale}/login`;
}
