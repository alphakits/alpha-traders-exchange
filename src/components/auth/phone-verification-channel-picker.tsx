"use client";

import { useId } from "react";
import type { PhoneVerificationChannel, PhoneVerificationChannels } from "@/lib/phone-verification-channel";

export function PhoneVerificationChannelPicker({
  locale, value, onChange, disabled = false, channels,
}: {
  locale: "en" | "ar";
  value: PhoneVerificationChannel;
  onChange: (value: PhoneVerificationChannel) => void;
  disabled?: boolean;
  channels?: PhoneVerificationChannels;
}) {
  const id = useId();
  const isAr = locale === "ar";
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2">
      <legend className="text-sm text-[#D1D5DB]">{isAr ? "كيف تريد استلام الرمز؟" : "How would you like to receive your code?"}</legend>
      <div className="flex flex-wrap gap-2">
        {(["sms", "whatsapp"] as const).map(channel => {
          const available = channel === "sms" && channels?.[channel] !== false;
          return (
            <label key={channel} className={`flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2 text-sm ${!available ? "border-white/10 text-[#9CA3AF]" : value === channel ? "border-[#C9A227] text-[#E8C547]" : "border-white/20 text-white"}`}>
              <input type="radio" name={`phone-channel-${id}`} value={channel} checked={value === channel} disabled={!available} onChange={() => onChange(channel)} className="accent-[#C9A227]" />
              {channel === "sms" ? (isAr ? "رسالة SMS" : "SMS") : "WhatsApp"}
              {!available ? <span>{isAr ? "(غير متاح حاليًا)" : "(currently unavailable)"}</span> : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
