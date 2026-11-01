import { splitAccentText } from "@alpha-traders/contracts";
import { moneyColors } from "@alpha-traders/design-tokens";

export function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

/** Interpolate visible text only. URLs and identifiers are escaped separately. */
export function emailDisplayHtml(value: string, surface: keyof typeof moneyColors = "onDark") {
  const parts = splitAccentText(value, { groupQuantities: true });
  if (!parts) return escapeHtml(value);
  return parts.map(({ text, tone }) => tone === "money"
    ? `<span style="color:${moneyColors[surface]}">${escapeHtml(text)}</span>`
    : escapeHtml(text)).join("");
}

export function emailDisplayText(value: string) {
  return splitAccentText(value, { groupQuantities: true })?.map(part => part.text).join("") ?? value;
}
