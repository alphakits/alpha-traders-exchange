// Shared by the website and native text renderer. Keep stored copy as plain text.
const accentPattern = /(\balpha\s+traders\b|[أاآ]لفا\s+تريدرز|\busdt\b)/gi;
const hasAccent = /\balpha\s+traders\b|[أاآ]لفا\s+تريدرز|\busdt\b/i;

export function splitAccentText(value: string) {
  if (!hasAccent.test(value)) return null;
  return value.split(accentPattern).map((text, index) => ({
    text,
    tone: index % 2 === 0 ? null : /^usdt$/i.test(text) ? "usdt" as const : "brand" as const,
  }));
}
