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
  metadataBase: new URL("https://papership.today"),
  title: {
    default: "Paper Ship — Crypto Paper Trading",
    template: "%s | Paper Ship",
  },
  description:
    "Practice crypto trading with virtual funds, clear costs, and a complete trade history on PaperShip.today.",
  alternates: {
    canonical: "https://papership.today",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: [{ url: "/apple-icon.svg", type: "image/svg+xml" }],
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "Paper Ship — Crypto Paper Trading",
    description:
      "Practice crypto trading with virtual funds, clear costs, and a complete trade history.",
    url: "https://papership.today",
    siteName: "Paper Ship",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Paper Ship — Crypto Paper Trading",
    description:
      "Practice crypto trading with virtual funds, clear costs, and a complete trade history.",
  },
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
            __html: `try { var theme = localStorage.getItem('papership-theme'); document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark'; } catch (_) { document.documentElement.dataset.theme = 'dark'; }`,
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
