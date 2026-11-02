import { useState } from "react";
import { TextInput, type TextInputProps } from "react-native";
import { formatMoneyNumber } from "@alpha-traders/contracts";
import { moneyColors } from "@alpha-traders/design-tokens";

/** Keep the editable draft and submitted amount separate from its grouped display. */
export function MoneyInput({ value, onFocus, onBlur, style, placeholder, ...props }: TextInputProps) {
  const [editing, setEditing] = useState(false);
  return <TextInput
    {...props}
    value={editing || value === undefined ? value : formatMoneyNumber(value)}
    placeholder={placeholder ? formatMoneyNumber(placeholder) : placeholder}
    onFocus={event => { setEditing(true); onFocus?.(event); }}
    onBlur={event => { setEditing(false); onBlur?.(event); }}
    style={[style, { color: moneyColors.onDark }]}
    placeholderTextColor={moneyColors.onDark}
  />;
}
