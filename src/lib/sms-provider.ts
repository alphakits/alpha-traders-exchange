
export type SmsProvider = {
  sendOtp: (input: { phone: string }) => Promise<{ ok: true }>;
  verifyOtp: (input: { phone: string; token: string }) => Promise<{ ok: true }>;
};

export type OtpSupportCode = "OTP_PROVIDER_CONFIGURATION" | "OTP_PROVIDER_RATE_LIMIT" | "OTP_PHONE_INVALID" | "OTP_PROVIDER_DELIVERY" | "OTP_PROVIDER_UNKNOWN";

export class OtpProviderError extends Error {
  public supportCode: OtpSupportCode;
  public stage: "send" | "verify";
  public provider: "twilio";
  public rawMessage: string;
  public rawCode?: string;
  public rawStatus?: number;

  constructor(input: { message: string; supportCode: OtpSupportCode; stage: "send" | "verify"; rawMessage: string; rawCode?: string; rawStatus?: number }) {
    super(input.message);
    this.name = "OtpProviderError";
    this.supportCode = input.supportCode;
    this.stage = input.stage;
    this.provider = "twilio";
    this.rawMessage = input.rawMessage;
    this.rawCode = input.rawCode;
    this.rawStatus = input.rawStatus;
  }
}

/** New routes persist a salted digest in the exchange store before calling Twilio. */
export function getSmsProvider(): SmsProvider {
  return {
    async sendOtp() {
      throw new OtpProviderError({ message: "Phone verification must use the secure account verification flow.", supportCode: "OTP_PROVIDER_CONFIGURATION", stage: "send", rawMessage: "Direct OTP provider use is disabled to prevent unpersisted codes." });
    },
    async verifyOtp() {
      throw new OtpProviderError({ message: "Verification must be completed through the secure account verification flow.", supportCode: "OTP_PROVIDER_CONFIGURATION", stage: "verify", rawMessage: "OTP verification state is stored by the exchange profile flow." });
    },
  };
}
