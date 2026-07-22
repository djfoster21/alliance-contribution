import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium",
  {
    variants: {
      variant: {
        neutral: "bg-background text-secondary border border-border",
        accent: "bg-accent-subtle text-accent",
        up: "bg-up/10 text-up",
        down: "bg-down/10 text-down",
        warn: "bg-warn/10 text-warn",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
