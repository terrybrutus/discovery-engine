"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Dark-only Toaster. This app is intentionally dark-themed with
 * `class="dark"` on the <html> tag and no ThemeProvider, so we hardcode
 * `theme="dark"` instead of reading from next-themes.
 */
const Toaster = ({ theme = "dark", ...props }: ToasterProps) => {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
