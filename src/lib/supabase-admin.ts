import { createClient } from "@supabase/supabase-js";

const DEFAULT_ADMIN_MEDIA_BUCKET = "admin-media";

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

function getServiceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

export function getAdminMediaBucket() {
  return process.env.SUPABASE_ADMIN_MEDIA_BUCKET?.trim() || DEFAULT_ADMIN_MEDIA_BUCKET;
}

export function createSupabaseAdminClient() {
  const url = getSupabaseUrl();
  const serviceRoleKey = getServiceRoleKey();

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase admin storage is not configured.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
