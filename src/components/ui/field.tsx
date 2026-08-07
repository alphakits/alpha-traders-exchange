import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Consistent field label with a required asterisk in Alpha red, or an
 * "(optional)" hint. Pair with `requiredFieldClasses` for the input border.
 */
export function FieldLabel({
  htmlFor,
  required = false,
  optional = false,
  className,
  children,
}: {
  htmlFor?: string;
  required?: boolean;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn("flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#D1D5DB]", className)}
    >
      <span>{children}</span>
      {required ? (
        <span className="text-sm font-bold leading-none text-[#F04438]" aria-hidden="true">*</span>
      ) : null}
      {optional ? (
        <span className="font-normal normal-case tracking-normal text-[11px] text-[#6B7280]">(optional)</span>
      ) : null}
    </label>
  );
}

/**
 * Border/ring treatment for a required field: red while empty or invalid,
 * green once it holds a valid value. Keeps validation visible on mobile.
 */
export function requiredFieldClasses(opts: { value?: string | number | null; invalid?: boolean; required?: boolean }): string {
  const empty = !String(opts.value ?? "").trim();
  if (opts.invalid) {
    return "border-[#F04438]/80 focus-visible:ring-[#F04438]/60 shadow-[0_0_0_3px_rgba(240,68,56,0.14)]";
  }
  if (opts.required && empty) {
    return "border-[#F04438]/55 focus-visible:ring-[#F04438]/50";
  }
  if (!empty) {
    return "border-emerald-500/60 focus-visible:ring-emerald-500/50";
  }
  return "";
}
