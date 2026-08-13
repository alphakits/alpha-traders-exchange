const PHONE_NUMBER_PATTERN = /(?:\+972|00972|0)[\s().-]*(?:\d[\s().-]*){8,10}/g;

export function redactPhoneNumbers(value: string) {
  return value.replace(PHONE_NUMBER_PATTERN, "[private contact removed]");
}