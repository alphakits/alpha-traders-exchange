import { forwardRef, type ReactNode } from "react";
import { Text as NativeText, type TextProps } from "react-native";
import { splitAccentText } from "../../../../src/lib/accent-text";

type BrandedTextProps = TextProps & { accentTone?: "default" | "onGold" };

function accentChildren(value: ReactNode, onGold: boolean): ReactNode {
  if (Array.isArray(value)) return value.map((child) => accentChildren(child, onGold));
  if (typeof value !== "string") return value;
  const parts = splitAccentText(value);
  if (!parts) return value;
  return parts.map(({ text, tone }, index) => tone ? (
    <NativeText key={index} style={tone === "brand"
      ? { color: onGold ? "#9f1239" : "#fda4af", fontWeight: "700" }
      : { color: onGold ? "#065f46" : "#34d399" }}>
      {text}
    </NativeText>
  ) : text);
}

/** Keeps native labels, accessibility, selection and text layout intact. */
export const BrandedText = forwardRef<NativeText, BrandedTextProps>(
  ({ children, accentTone = "default", ...props }, ref) => (
    <NativeText {...props} ref={ref}>{accentChildren(children, accentTone === "onGold")}</NativeText>
  ),
);
BrandedText.displayName = "BrandedText";
