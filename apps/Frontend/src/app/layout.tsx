import type { Metadata } from "next";
import { Toaster } from "react-hot-toast";
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
      <body className="bg-[#050f1a] text-[#e2e8f0] antialiased">
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "#0a1929",
              color: "#e2e8f0",
              border: "1px solid #1e3a5f",
              fontFamily: "'JetBrains Mono', monospace",
            },
          }}
        />
        {children}
      </body>
    </html>
  );
}
