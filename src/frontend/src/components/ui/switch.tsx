"use client";

import { cn } from "@/lib/utils";
import type * as React from "react";

type SwitchProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "type"
> & {
  onCheckedChange?: (checked: boolean) => void;
};

function Switch({
  checked,
  className,
  disabled,
  onCheckedChange,
  ...props
}: SwitchProps) {
  return (
    <span
      data-slot="switch"
      data-state={checked ? "checked" : "unchecked"}
      className={cn(
        "relative inline-flex h-[1.15rem] w-8 shrink-0 items-center",
        className,
      )}
    >
      <input
        {...props}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
        className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span className="absolute inset-0 rounded-full border border-transparent bg-input shadow-xs transition-all peer-checked:bg-primary peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-disabled:opacity-50 dark:bg-input/80" />
      <span className="pointer-events-none relative block size-4 translate-x-0 rounded-full bg-background ring-0 transition-transform peer-checked:translate-x-[calc(100%-2px)] dark:bg-foreground peer-checked:dark:bg-primary-foreground" />
    </span>
  );
}

export { Switch };
