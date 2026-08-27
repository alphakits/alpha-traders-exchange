import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSiteUrl } from "@/lib/site-url";
import { resolveClientIp } from "@/lib/rate-limit";
import { resolveSupportedRequestLocale } from "@/lib/request-locale";

type Locale = "ar" | "en";

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

function getSupabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
}

function getSupabaseServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

export function createSupabaseAuthClient(options?: { requestHeaders?: Headers }) {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!url || !anonKey) {
    throw new Error("Supabase authentication is not configured.");
  }
  const forwardedFor = options?.requestHeaders ? resolveClientIp(options.requestHeaders) : null;
  const globalHeaders: Record<string, string> = {};
  if (forwardedFor && forwardedFor !== "unknown") {
    // Preserve real client IP for provider-side abuse controls behind proxies (Vercel/CDN).
    globalHeaders["x-forwarded-for"] = forwardedFor;
  }
  return createClient(url, anonKey, {
    global: {
      headers: globalHeaders,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function createSupabaseAdminClient() {
  const url = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase admin authentication is not configured.");
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function inferLocaleFromRequest(request: NextRequest): Locale {
  return resolveSupportedRequestLocale(request.headers, "en");
}

export function getSupabaseEmailRedirectUrl(locale: Locale) {
  return `${getSiteUrl()}/${locale}/login`;
}
