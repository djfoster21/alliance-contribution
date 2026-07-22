import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

// indicatorClassName colors the fill via a static class; indicatorStyle sets it inline for
// value-dependent colors (e.g. threshold meters) where a runtime Tailwind class would not be emitted.
export const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    indicatorClassName?: string;
    indicatorStyle?: React.CSSProperties;
  }
>(({ className, value, indicatorClassName, indicatorStyle, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-background", className)}
    value={value}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={cn("h-full w-full flex-1 bg-accent transition-transform duration-300", indicatorClassName)}
      style={{ transform: `translateX(-${100 - (value || 0)}%)`, ...indicatorStyle }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = "Progress";
