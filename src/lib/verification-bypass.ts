function parseBypassEmails(raw: string | undefined) {
  if (!raw) return new Set<string>();
  return new Set(
    raw
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

export function isPhotoVerificationBypassed(email: string | null | undefined) {
  if (!email) return false;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;
  const bypassEmails = parseBypassEmails(process.env.PHOTO_VERIFICATION_BYPASS_EMAILS);
  return bypassEmails.has(normalizedEmail);
}
