type AuthProviderError = {
  code?: string;
  name?: string;
  status?: number;
  message?: string;
};

export const AUTH_WEAK_PASSWORD_COPY = {
  en: "This password is too weak or has appeared in a data breach. Choose a stronger, unique password.",
  ar: "كلمة المرور ضعيفة أو ظهرت في تسريب بيانات. اختر كلمة مرور أقوى وفريدة.",
};

export function isWeakPasswordError(error: AuthProviderError) {
  const message = (error.message ?? "").toLowerCase();
  return error.code === "weak_password" || error.name === "AuthWeakPasswordError"
    || /password.*(weak|leaked|compromised|breach)/.test(message);
}

export function isAuthProviderRateLimitError(error: AuthProviderError) {
  return error.status === 429 || error.code === "over_email_send_rate_limit"
    || error.code === "over_request_rate_limit"
    || /rate limit|too many requests/i.test(error.message ?? "");
}

export function isAuthProviderUnavailableError(error: AuthProviderError) {
  return (error.status ?? 0) >= 500 || error.name === "AuthRetryableFetchError"
    || error.code === "unexpected_failure";
}

export function authProviderLogMetadata(error: AuthProviderError) {
  return {
    provider: "supabase",
    providerError: typeof error.code === "string" && /^[a-z_]{1,64}$/.test(error.code)
      ? error.code : undefined,
    providerStatus: error.status,
  };
}
