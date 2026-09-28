const PRIVATE_CONTACT_PLACEHOLDER = "[private contact removed]";
const ISRAELI_PHONE_NUMBER_SOURCE = "(?<![\\w])0\\s*(?:[234789]|5\\s*\\d)(?:[\\s().-]*\\d){7}(?![\\w])";
const INTERNATIONAL_PHONE_NUMBER_SOURCE = "(?<![\\w])(?:\\+\\s*\\d{1,3}|00\\s*\\d{1,3})(?:[\\s().-]*\\d){7,12}(?![\\w])";
// Require explicit separators for non-Israeli local numbers. This catches clear
// contact forms such as 555-123-4567 without treating arbitrary contiguous
// numeric values (bank accounts, prices, hashes, or wallet fragments) as phones.
const GENERIC_DASHED_LOCAL_PHONE_NUMBER_SOURCE = "(?<![\\w])(?:\\(?[2-9]\\d{2}\\)?)[\\s.-]+\\d{3}[\\s.-]+\\d{4}(?![\\w])";
const EMAIL_ADDRESS_SOURCE = "\\b[A-Z0-9._%+-]+\\s*@\\s*[A-Z0-9.-]+\\s*\\.\\s*[A-Z]{2,}\\b";
const OBFUSCATED_EMAIL_SOURCE = "\\b[A-Z0-9._%+-]+\\s*(?:\\[|\\()\\s*at\\s*(?:\\]|\\))\\s*[A-Z0-9.-]+\\s*(?:\\[|\\()\\s*dot\\s*(?:\\]|\\))\\s*[A-Z]{2,}\\b";
const DIRECT_CONTACT_URL_SOURCE = "(?:\\b(?:https?:\\/\\/)?(?:www\\.)?(?:wa\\.me|api\\.whatsapp\\.com|chat\\.whatsapp\\.com|whatsapp\\.com|t\\.me|telegram\\.me|telegram\\.dog|signal\\.me|m\\.me|messenger\\.com|viber\\.com|line\\.me|discord\\.gg|discord(?:app)?\\.com\\/invite|skype\\.com|join\\.skype\\.com|instagram\\.com|facebook\\.com|fb\\.me|x\\.com|twitter\\.com|snapchat\\.com)\\/[^\\s<>\"']+|\\b(?:mailto|tel|sms|skype):[^\\s<>\"']+)";
const TELEGRAM_CONTACT_SOURCE = "\\b(?:telegram|tele\\s*gram|tg)\\s*(?:(?:handle|username|user(?:name)?|contact|dm|message|at)\\s*)?[:@-]\\s*@?[A-Z0-9_]{5,32}\\b";
const BARE_CONTACT_HANDLE_SOURCE = "(?<![\\w@])@[A-Z0-9_]{5,32}\\b";
const CONTACT_ON_PLATFORM_SOURCE = "\\b(?:contact|message|dm|reach|write)\\s+(?:me|us)\\s+(?:on|via|at)\\s+(?:whats\\s*app|telegram|tele\\s*gram|signal|viber|line|discord)\\b";

const ISRAELI_PHONE_NUMBER_PATTERN = new RegExp(ISRAELI_PHONE_NUMBER_SOURCE, "gi");
const INTERNATIONAL_PHONE_NUMBER_PATTERN = new RegExp(INTERNATIONAL_PHONE_NUMBER_SOURCE, "gi");
const GENERIC_DASHED_LOCAL_PHONE_NUMBER_PATTERN = new RegExp(GENERIC_DASHED_LOCAL_PHONE_NUMBER_SOURCE, "gi");
const DIRECT_CONTACT_URL_PATTERN = new RegExp(DIRECT_CONTACT_URL_SOURCE, "gi");
const EMAIL_ADDRESS_PATTERN = new RegExp(EMAIL_ADDRESS_SOURCE, "gi");
const OBFUSCATED_EMAIL_PATTERN = new RegExp(OBFUSCATED_EMAIL_SOURCE, "gi");
const TELEGRAM_CONTACT_PATTERN = new RegExp(TELEGRAM_CONTACT_SOURCE, "gi");
const BARE_CONTACT_HANDLE_PATTERN = new RegExp(BARE_CONTACT_HANDLE_SOURCE, "gi");
const CONTACT_ON_PLATFORM_PATTERN = new RegExp(CONTACT_ON_PLATFORM_SOURCE, "gi");

const CONTACT_DETECTION_PATTERNS = [
  ["telegram", new RegExp(`(?:${TELEGRAM_CONTACT_SOURCE}|${BARE_CONTACT_HANDLE_SOURCE}|\\b(?:t\\.me|telegram\\.me|telegram\\.dog)\\/)`, "i")],
  ["contact_url", new RegExp(DIRECT_CONTACT_URL_SOURCE, "i")],
  ["email", new RegExp(`(?:${EMAIL_ADDRESS_SOURCE}|${OBFUSCATED_EMAIL_SOURCE})`, "i")],
  ["phone", new RegExp(`(?:${ISRAELI_PHONE_NUMBER_SOURCE}|${INTERNATIONAL_PHONE_NUMBER_SOURCE}|${GENERIC_DASHED_LOCAL_PHONE_NUMBER_SOURCE})`, "i")],
  ["contact_platform", new RegExp(CONTACT_ON_PLATFORM_SOURCE, "i")],
] as const;

export type DirectContactContentKind = (typeof CONTACT_DETECTION_PATTERNS)[number][0];

export const DIRECT_CONTACT_CONTENT_ERROR = "For your privacy and security, direct contact information cannot be shared. Please keep communication inside the Alpha Exchange Trade Room.";

function asText(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKC") : "";
}

/**
 * Detects direct-contact details in Buyer/Seller-authored text. Keep this
 * deliberately scoped to clear contact forms: arbitrary numeric strings,
 * wallets, hashes, prices, and bank fields must be validated by their own
 * domain-specific logic rather than being mistaken for phone numbers here.
 */
export function findDirectContactContent(value: unknown): DirectContactContentKind | null {
  const text = asText(value);
  if (!text) return null;
  for (const [kind, pattern] of CONTACT_DETECTION_PATTERNS) {
    if (pattern.test(text)) return kind;
  }
  return null;
}

export function containsDirectContactContent(value: unknown) {
  return findDirectContactContent(value) !== null;
}

export function assertNoDirectContactContent(value: unknown) {
  if (containsDirectContactContent(value)) {
    throw new Error(DIRECT_CONTACT_CONTENT_ERROR);
  }
}

export function redactPhoneNumbers(value: string) {
  return value
    .replace(INTERNATIONAL_PHONE_NUMBER_PATTERN, PRIVATE_CONTACT_PLACEHOLDER)
    .replace(GENERIC_DASHED_LOCAL_PHONE_NUMBER_PATTERN, PRIVATE_CONTACT_PLACEHOLDER)
    .replace(ISRAELI_PHONE_NUMBER_PATTERN, PRIVATE_CONTACT_PLACEHOLDER);
}

/**
 * Notification and transactional-email copy must never reveal a participant's
 * direct contact details, including data that may exist in legacy records.
 */
export function redactPrivateContactDetails(value: string) {
  return value
    .replace(DIRECT_CONTACT_URL_PATTERN, PRIVATE_CONTACT_PLACEHOLDER)
    .replace(EMAIL_ADDRESS_PATTERN, PRIVATE_CONTACT_PLACEHOLDER)
    .replace(OBFUSCATED_EMAIL_PATTERN, PRIVATE_CONTACT_PLACEHOLDER)
    .replace(TELEGRAM_CONTACT_PATTERN, PRIVATE_CONTACT_PLACEHOLDER)
    .replace(BARE_CONTACT_HANDLE_PATTERN, PRIVATE_CONTACT_PLACEHOLDER)
    .replace(CONTACT_ON_PLATFORM_PATTERN, PRIVATE_CONTACT_PLACEHOLDER)
    .replace(INTERNATIONAL_PHONE_NUMBER_PATTERN, PRIVATE_CONTACT_PLACEHOLDER)
    .replace(GENERIC_DASHED_LOCAL_PHONE_NUMBER_PATTERN, PRIVATE_CONTACT_PLACEHOLDER)
    .replace(ISRAELI_PHONE_NUMBER_PATTERN, PRIVATE_CONTACT_PLACEHOLDER);
}
