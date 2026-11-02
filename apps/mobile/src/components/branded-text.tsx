import { forwardRef, type ReactNode } from "react";
import { Text as NativeText, type TextProps } from "react-native";
import { formatMoneyNumber, splitAccentText } from "@alpha-traders/contracts";
import { moneyColors } from "@alpha-traders/design-tokens";

type BrandedTextProps = TextProps & {
  accentTone?: "default" | "onGold";
  monetary?: boolean;
  preserveNumbers?: boolean;
};

function accentChildren(value: ReactNode, onGold: boolean, monetary: boolean, preserveNumbers: boolean): ReactNode {
  if (Array.isArray(value)) {
    // JSX may supply an amount, a space and its currency as separate children.
    // Join adjacent text only, retaining nested controls, labels and their props.
    const runs: ReactNode[] = [];
    for (const child of value) {
      if (typeof child === "string" || typeof child === "number") {
        const previous = runs[runs.length - 1];
        if (typeof previous === "string") runs[runs.length - 1] = previous + String(child);
        else runs.push(String(child));
      } else if (child != null && typeof child !== "boolean") runs.push(child);
    }
    return runs.map(child => accentChildren(child, onGold, monetary, preserveNumbers));
  }
  if (typeof value !== "string" && typeof value !== "number") return value;
  if (monetary) return preserveNumbers ? value : formatMoneyNumber(value);
  const parts = splitAccentText(String(value), { groupNumbers: !preserveNumbers, groupQuantities: !preserveNumbers });
  if (!parts) return value;
  return parts.map(({ text, tone }, index) => tone ? (
    <NativeText key={index} style={tone === "brand"
      ? { color: onGold ? "#9f1239" : "#fda4af", fontWeight: "700" }
      : { color: onGold ? moneyColors.onGold : moneyColors.onDark }}>
      {text}
    </NativeText>
  ) : text);
}

/** Keeps native labels, accessibility, selection and text layout intact. */
export const BrandedText = forwardRef<NativeText, BrandedTextProps>(
  ({ children, accentTone = "default", monetary = false, preserveNumbers = false, style, ...props }, ref) => (
    <NativeText {...props} ref={ref} style={[style, monetary && { color: accentTone === "onGold" ? moneyColors.onGold : moneyColors.onDark }]}>
      {accentChildren(children, accentTone === "onGold", monetary, preserveNumbers)}
    </NativeText>
  ),
);
BrandedText.displayName = "BrandedText";
