import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-full text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A227] disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none",
  {
    variants: {
      variant: {
        default: "gold-gradient text-black shadow-[0_8px_20px_rgba(201,162,39,0.2)] hover:-translate-y-0.5 hover:opacity-90",
        secondary: "border border-white/20 bg-transparent text-white hover:-translate-y-0.5 hover:border-[#C9A227] hover:text-[#C9A227]",
      },
      size: {
        default: "h-11 px-6",
        sm: "h-9 px-4",
        lg: "h-12 px-8",
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
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";
