import { headers } from "next/headers";
import type { Metadata } from "next";
import { Toaster } from "react-hot-toast";

import "./globals.css";

export const metadata: Metadata = {
  title: "OrbitLedger — Crypto paper trading",
  description:
    "Practice crypto trading with virtual funds, clear costs, and a complete trade history.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;450;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-[var(--nt-bg)] text-[var(--nt-text)] antialiased">
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `try { var theme = localStorage.getItem('orbitledger-theme'); document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark'; } catch (_) { document.documentElement.dataset.theme = 'dark'; }`,
          }}
        />
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
