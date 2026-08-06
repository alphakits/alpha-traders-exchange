import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none active:translate-y-0 active:scale-[0.97]",
  {
    variants: {
      variant: {
        default: "gold-gradient text-black shadow-[0_8px_20px_rgba(201,162,39,0.22)] hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(201,162,39,0.32)]",
        secondary: "border border-white/20 bg-transparent text-white hover:-translate-y-0.5 hover:border-[#C9A227] hover:text-[#C9A227]",
        outline: "border border-[#C9A227]/40 bg-transparent text-[#C9A227] hover:-translate-y-0.5 hover:border-[#C9A227]/70 hover:bg-[#C9A227]/10",
        ghost: "bg-transparent text-[#9CA3AF] hover:bg-white/[0.06] hover:text-white",
        destructive: "border border-red-500/30 bg-red-950/30 text-red-400 hover:border-red-500/50 hover:bg-red-950/50",
      },
      size: {
        default: "h-11 px-6",
        sm: "h-11 px-4 md:h-9",
        lg: "h-12 px-8 text-base",
        icon: "h-11 w-11 p-0 md:h-9 md:w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  loadingLabel?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", loading = false, loadingLabel, disabled, children, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        <span>{loading && loadingLabel ? loadingLabel : children}</span>
      </button>
    );
  },
);
Button.displayName = "Button";
