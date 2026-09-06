import type { NextRequest } from "next/server";
import { authenticateLocalUser } from "@/lib/auth";
import { upsertUserProfileForAuth } from "@/lib/alpha-exchange-store";
import { createSupabaseAuthClient } from "@/lib/supabase-auth-provider";
import type { AlphaExchangeUser } from "@/types/alpha-exchange";

export type MobileCredentialResult =
  | { status: "authenticated"; user: AlphaExchangeUser }
  | { status: "invalid" }
  | { status: "email_unverified" }
  | { status: "disabled" };

export async function authenticateMobileCredentials(
  request: NextRequest,
  email: string,
  password: string,
): Promise<MobileCredentialResult> {
  const localUser = await authenticateLocalUser(email, password);
  if (localUser) {
    if (localUser.disabled) return { status: "disabled" };
    if (localUser.emailVerified !== true) return { status: "email_unverified" };
    const user = await upsertUserProfileForAuth({
      fullName: localUser.fullName,
      email: localUser.email,
      whatsappNumber: localUser.whatsappNumber,
      emailVerified: true,
    });
    return user.disabled
      ? { status: "disabled" }
      : { status: "authenticated", user };
  }

  const supabase = createSupabaseAuthClient({ requestHeaders: request.headers });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return error.message.toLowerCase().includes("email not confirmed")
      ? { status: "email_unverified" }
      : { status: "invalid" };
  }
  const supabaseUser = data.user;
  if (!supabaseUser?.email) return { status: "invalid" };
  if (!supabaseUser.email_confirmed_at) return { status: "email_unverified" };
  const user = await upsertUserProfileForAuth({
    fullName: String(supabaseUser.user_metadata?.full_name ?? supabaseUser.email.split("@")[0]),
    email: supabaseUser.email,
    whatsappNumber: String(supabaseUser.user_metadata?.whatsapp_number ?? ""),
    emailVerified: true,
  });
  return user.disabled
    ? { status: "disabled" }
    : { status: "authenticated", user };
}
