import * as React from "react";
import { cn } from "@/lib/utils";

type UsdtIconProps = {
  className?: string;
  ringClassName?: string;
  label?: string;
};

export function UsdtIcon({ className, ringClassName, label = "USDT" }: UsdtIconProps) {
  return (
    <span
      aria-label={label}
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#26A17B]/40 bg-[#26A17B]/15 text-[10px] font-bold leading-none text-[#7CF3CF]",
        ringClassName,
      )}
    >
      <span className={cn("translate-y-[0.5px] select-none", className)}>₮</span>
    </span>
  );
}
