"use client";

import { useLayoutEffect, useReducer, useRef, type InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";
import { normalizeTradeAmountInput } from "@/lib/trade-amount";

// String formatting preserves incomplete decimals, trailing zeros and all six
// USDT decimal places. Group separators never enter the stored form value.
function groupDecimal(value: string) {
  const [whole, fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

function withoutGrouping(value: string) {
  return value.replace(/[,٬]/g, "");
}

function displayPosition(value: string, rawPosition: number) {
  let digits = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (digits === rawPosition) return index;
    if (value[index] !== ",") digits += 1;
  }
  return value.length;
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type"> & {
  value: string;
  onValueChange: (value: string) => void;
  normalize?: (value: string) => string;
};

export function GroupedDecimalInput({ value, onValueChange, normalize = normalizeTradeAmountInput, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const [, refreshSelection] = useReducer((revision: number) => revision + 1, 0);
  const displayed = groupDecimal(value);

  useLayoutEffect(() => {
    if (!selection.current || !input.current) return;
    const { start, end } = selection.current;
    input.current.setSelectionRange(displayPosition(displayed, start), displayPosition(displayed, end));
    selection.current = null;
  });

  return <Input
    {...props}
    ref={input}
    type="text"
    inputMode="decimal"
    dir="ltr"
    value={displayed}
    onChange={(event) => {
      let edited = event.currentTarget.value;
      let start = event.currentTarget.selectionStart ?? edited.length;
      let end = event.currentTarget.selectionEnd ?? start;
      const inputType = (event.nativeEvent as InputEvent).inputType;

      // A mobile keyboard can delete just a generated comma. Treat that as
      // deleting the adjacent digit, so the separator cannot trap the cursor.
      if (edited.length === displayed.length - 1 && withoutGrouping(edited) === value) {
        if (inputType === "deleteContentBackward" && start > 0) {
          edited = edited.slice(0, start - 1) + edited.slice(start);
          start -= 1;
          end = start;
        } else if (inputType === "deleteContentForward") {
          edited = edited.slice(0, start) + edited.slice(start + 1);
          end = start;
        }
      }

      const nextValue = normalize(withoutGrouping(edited));
      selection.current = {
        start: normalize(withoutGrouping(edited.slice(0, start))).length,
        end: normalize(withoutGrouping(edited.slice(0, end))).length,
      };
      onValueChange(nextValue);
      // A rejected/clamped edit can keep the parent's value unchanged.
      // Still restore its display and caret without an asynchronous timer.
      refreshSelection();
    }}
  />;
}
