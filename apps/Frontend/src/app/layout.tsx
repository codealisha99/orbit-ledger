import { headers } from "next/headers";
import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Toaster } from "react-hot-toast";

import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

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
    <html lang="en" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable}`}>
      <head />
      <body className="bg-[var(--nt-bg)] text-[var(--nt-text)] antialiased">
        <script
          nonce={nonce}
          suppressHydrationWarning
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
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
            },
          }}
        />
        {children}
      </body>
    </html>
  );
}
