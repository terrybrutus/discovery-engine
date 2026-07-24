"use client";

import { cn } from "@/lib/utils";
import { CheckIcon } from "lucide-react";
import type * as React from "react";

type CheckboxProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "type"
> & {
  onCheckedChange?: (checked: boolean) => void;
};

function Checkbox({
  checked,
  className,
  disabled,
  onCheckedChange,
  ...props
}: CheckboxProps) {
  return (
    <span
      data-slot="checkbox"
      data-state={checked ? "checked" : "unchecked"}
      className={cn("relative size-4 shrink-0", className)}
    >
      <input
        {...props}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
        className="peer absolute inset-0 z-10 m-0 size-4 cursor-pointer appearance-none rounded-[4px] border border-input bg-transparent shadow-xs outline-none transition-shadow checked:border-primary checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
      />
      <CheckIcon className="pointer-events-none absolute inset-0 z-20 hidden size-4 p-[1px] text-primary-foreground peer-checked:block" />
    </span>
  );
}

export { Checkbox };
