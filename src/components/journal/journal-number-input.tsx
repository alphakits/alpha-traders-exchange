import type { InputHTMLAttributes } from "react";
import { formatMoneyNumber } from "@/lib/accent-text";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "className"> & {
  value: string | number;
  money?: boolean;
};

/** The grouped resting display is visual only. The native field retains its value and validation. */
export function JournalNumberInput({ value, money = true, ...input }: Props) {
  const raw = String(value);
  const grouped = /^[+-]?\d+(?:\.\d*)?$/.test(raw) ? formatMoneyNumber(raw) : raw;
  const className = money ? "currency-money" : undefined;
  return <span className="j-number-field" dir="ltr" data-grouped={grouped !== raw || undefined}>
    <input {...input} value={value} dir="ltr" className={className} />
    {grouped !== raw && <span aria-hidden="true" className={className}>{grouped}</span>}
  </span>;
}
