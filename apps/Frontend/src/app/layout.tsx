import type { Metadata } from "next";
import { Toaster } from "react-hot-toast";
import ThemeToggle from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "OrbitLedger — Precision Trading. Real-Time Edge.",
  description:
    "OrbitLedger is a professional CFD trading platform with leverage, TP/SL, trailing stop-loss, and real-time price feeds.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="font-mono">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[var(--nt-bg)] text-[var(--nt-text)] antialiased">
        <script
          dangerouslySetInnerHTML={{
            __html: `try { var theme = localStorage.getItem('orbitledger-theme'); document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark'; } catch (_) { document.documentElement.dataset.theme = 'dark'; }`,
          }}
        />
        <ThemeToggle />
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "var(--nt-surface)",
              color: "var(--nt-text)",
              border: "1px solid var(--nt-border)",
              fontFamily: "'JetBrains Mono', monospace",
            },
          }}
        />
        {children}
      </body>
    </html>
  );
}
