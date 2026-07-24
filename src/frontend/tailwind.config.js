import typography from "@tailwindcss/typography";
import containerQueries from "@tailwindcss/container-queries";
import animate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["index.html", "src/**/*.{js,ts,jsx,tsx,html,css}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "oklch(var(--border))",
        input: "oklch(var(--input))",
        ring: "oklch(var(--ring) / <alpha-value>)",
        background: "oklch(var(--background))",
        foreground: "oklch(var(--foreground))",
        primary: {
          DEFAULT: "oklch(var(--primary) / <alpha-value>)",
          foreground: "oklch(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "oklch(var(--secondary) / <alpha-value>)",
          foreground: "oklch(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "oklch(var(--destructive) / <alpha-value>)",
          foreground: "oklch(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "oklch(var(--muted) / <alpha-value>)",
          foreground: "oklch(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "oklch(var(--accent) / <alpha-value>)",
          foreground: "oklch(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "oklch(var(--popover))",
          foreground: "oklch(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "oklch(var(--card))",
          foreground: "oklch(var(--card-foreground))",
        },
        chart: {
          1: "oklch(var(--chart-1))",
          2: "oklch(var(--chart-2))",
          3: "oklch(var(--chart-3))",
          4: "oklch(var(--chart-4))",
          5: "oklch(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "oklch(var(--sidebar))",
          foreground: "oklch(var(--sidebar-foreground))",
          primary: "oklch(var(--sidebar-primary))",
          "primary-foreground": "oklch(var(--sidebar-primary-foreground))",
          accent: "oklch(var(--sidebar-accent))",
          "accent-foreground": "oklch(var(--sidebar-accent-foreground))",
          border: "oklch(var(--sidebar-border))",
          ring: "oklch(var(--sidebar-ring))",
        },
        "depth-light": {
          DEFAULT: "oklch(var(--depth-light) / <alpha-value>)",
          foreground: "oklch(var(--depth-light-foreground))",
        },
        "depth-deep": {
          DEFAULT: "oklch(var(--depth-deep) / <alpha-value>)",
          foreground: "oklch(var(--depth-deep-foreground))",
        },
        "dataset-stripe": "oklch(var(--dataset-stripe))",
        "correlation-cell": "oklch(var(--correlation-cell) / <alpha-value>)",
        "diff-added": {
          DEFAULT: "oklch(var(--diff-added) / <alpha-value>)",
          foreground: "oklch(var(--diff-added-foreground))",
        },
        "diff-removed": {
          DEFAULT: "oklch(var(--diff-removed) / <alpha-value>)",
          foreground: "oklch(var(--diff-removed-foreground))",
        },
        "diff-changed": {
          DEFAULT: "oklch(var(--diff-changed) / <alpha-value>)",
          foreground: "oklch(var(--diff-changed-foreground))",
        },
        surviving: {
          DEFAULT: "oklch(var(--surviving) / <alpha-value>)",
          foreground: "oklch(var(--surviving-foreground))",
        },
        degraded: {
          DEFAULT: "oklch(var(--degraded) / <alpha-value>)",
          foreground: "oklch(var(--degraded-foreground))",
        },
        "probe-bracket": {
          DEFAULT: "oklch(var(--probe-bracket) / <alpha-value>)",
          foreground: "oklch(var(--probe-bracket-foreground))",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgba(0,0,0,0.05)",
        subtle: "0 1px 0 0 oklch(0 0 0 / 0.08), 0 0 0 1px oklch(0 0 0 / 0.04)",
        elevated: "0 4px 12px -2px oklch(0 0 0 / 0.18), 0 1px 0 0 oklch(0 0 0 / 0.08)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "scan-line": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        "count-up": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "row-reveal": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "bracket-expand": {
          "0%": { transform: "scaleX(0)", transformOrigin: "left" },
          "100%": { transform: "scaleX(1)", transformOrigin: "left" },
        },
        "diff-flash": {
          "0%, 100%": { backgroundColor: "oklch(0 0 0 / 0)" },
          "30%": { backgroundColor: "oklch(var(--primary) / 0.18)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "scan-line": "scan-line 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        "pulse-soft": "pulse-soft 1.6s ease-in-out infinite",
        "count-up": "count-up 0.35s cubic-bezier(0.4, 0, 0.2, 1) both",
        "row-reveal": "row-reveal 0.3s cubic-bezier(0.4, 0, 0.2, 1) both",
        "bracket-expand": "bracket-expand 0.5s cubic-bezier(0.4, 0, 0.2, 1) both",
        "diff-flash": "diff-flash 0.8s ease-out",
      },
    },
  },
  plugins: [typography, containerQueries, animate],
};
