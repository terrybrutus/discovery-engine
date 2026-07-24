"use client";

import { cn } from "@/lib/utils";
import type * as React from "react";

type SliderProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "defaultValue" | "onChange" | "type" | "value"
> & {
  defaultValue?: number[];
  onValueChange?: (value: number[]) => void;
  onValueCommit?: (value: number[]) => void;
  value?: number[];
};

/**
 * Single-value slider used by the discovery controls.
 *
 * This intentionally uses the browser's native range input instead of the
 * Radix slider. Radix's thumb ref currently enters a React 19 update loop when
 * this page mounts, which trips the page error boundary before any controls
 * can render.
 */
function Slider({
  className,
  defaultValue,
  disabled,
  max = 100,
  min = 0,
  onValueChange,
  onValueCommit,
  step = 1,
  value,
  ...props
}: SliderProps) {
  const numericMin = Number(min);
  const numericMax = Number(max);
  const currentValue = value?.[0] ?? defaultValue?.[0] ?? numericMin;
  const range = numericMax - numericMin;
  const progress =
    range > 0
      ? Math.min(100, Math.max(0, ((currentValue - numericMin) / range) * 100))
      : 0;

  const emitValue = (
    handler: ((nextValue: number[]) => void) | undefined,
    nextValue: string,
  ) => {
    const parsed = Number(nextValue);
    if (Number.isFinite(parsed)) {
      handler?.([parsed]);
    }
  };

  return (
    <div
      data-slot="slider"
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "relative flex h-5 w-full items-center data-[disabled]:opacity-50",
        className,
      )}
    >
      <div
        data-slot="slider-track"
        className="pointer-events-none absolute inset-x-0 h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          data-slot="slider-range"
          className="h-full bg-primary"
          style={{ width: `${progress}%` }}
        />
      </div>
      <input
        {...props}
        type="range"
        min={numericMin}
        max={numericMax}
        step={step}
        value={currentValue}
        disabled={disabled}
        onChange={(event) =>
          emitValue(onValueChange, event.currentTarget.value)
        }
        onPointerUp={(event) =>
          emitValue(onValueCommit, event.currentTarget.value)
        }
        onKeyUp={(event) => emitValue(onValueCommit, event.currentTarget.value)}
        className="absolute inset-0 h-5 w-full cursor-pointer appearance-none bg-transparent outline-none disabled:cursor-not-allowed [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-background [&::-moz-range-thumb]:shadow-sm [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow-sm focus-visible:[&::-moz-range-thumb]:ring-4 focus-visible:[&::-moz-range-thumb]:ring-ring/50 focus-visible:[&::-webkit-slider-thumb]:ring-4 focus-visible:[&::-webkit-slider-thumb]:ring-ring/50"
      />
    </div>
  );
}

export { Slider };
