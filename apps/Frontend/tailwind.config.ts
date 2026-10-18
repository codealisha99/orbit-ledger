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
        mono: ["JetBrains Mono", "monospace"],
        sans: ["JetBrains Mono", "monospace"],
      },
      colors: {
        "nt-bg": "#050f1a",
        "nt-surface": "#0a1929",
        "nt-surface2": "#0d2137",
        "nt-border": "#1e3a5f",
        "nt-border-dim": "#132843",
        "nt-accent": "#0EA5E9",
        "nt-buy": "#22c55e",
        "nt-sell": "#ef4444",
        "nt-text": "#e2e8f0",
        "nt-muted": "#94a3b8",
        "nt-dim": "#64748b",
      },
    },
  },
  plugins: [],
};

export default config;
