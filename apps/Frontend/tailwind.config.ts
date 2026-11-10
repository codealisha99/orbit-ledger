import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      colors: {
        "nt-bg": "var(--nt-bg)",
        "nt-surface": "var(--nt-surface)",
        "nt-surface2": "var(--nt-surface2)",
        "nt-border": "var(--nt-border)",
        "nt-border-strong": "var(--nt-border-strong)",
        "nt-accent": "var(--nt-accent)",
        "nt-accent-ink": "var(--nt-accent-ink)",
        "nt-buy": "var(--nt-buy)",
        "nt-sell": "var(--nt-sell)",
        "nt-text": "var(--nt-text)",
        "nt-muted": "var(--nt-muted)",
        "nt-dim": "var(--nt-dim)",
      },
    },
  },
  plugins: [],
};

export default config;
