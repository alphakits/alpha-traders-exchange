export type PhoneVerificationChannel = "sms" | "whatsapp";
export type PhoneVerificationChannels = Readonly<Record<PhoneVerificationChannel, boolean>>;

// An omitted value preserves older app clients; every supplied value is strict.
export function parsePhoneVerificationChannel(value: unknown): PhoneVerificationChannel | undefined | null {
  if (value === undefined) return undefined;
  return value === "sms" || value === "whatsapp" ? value : null;
}
