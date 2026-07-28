import { createSupabaseAuthClient } from "@/lib/supabase-auth-provider";

export type SmsProvider = {
  sendOtp: (input: { phone: string }) => Promise<{ ok: true }>;
  verifyOtp: (input: { phone: string; token: string }) => Promise<{ ok: true }>;
};

function createSupabaseSmsProvider(): SmsProvider {
  const supabase = createSupabaseAuthClient();
  return {
    async sendOtp(input) {
      const { error } = await supabase.auth.signInWithOtp({
        phone: input.phone,
        options: { shouldCreateUser: false },
      });
      if (error) throw new Error(error.message);
      return { ok: true };
    },
    async verifyOtp(input) {
      const { error } = await supabase.auth.verifyOtp({
        phone: input.phone,
        token: input.token,
        type: "sms",
      });
      if (error) throw new Error(error.message);
      return { ok: true };
    },
  };
}

export function getSmsProvider(): SmsProvider {
  return createSupabaseSmsProvider();
}
