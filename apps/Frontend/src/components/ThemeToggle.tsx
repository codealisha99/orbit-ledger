"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const pathname = usePathname();

  useEffect(() => {
    const saved = localStorage.getItem("orbitledger-theme");
    const initial: Theme = saved === "light" || saved === "dark" ? saved : "dark";
    document.documentElement.dataset.theme = initial;
    setTheme(initial);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("orbitledger-theme", next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className={`fixed right-4 z-[100] inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-[var(--nt-border)] bg-[var(--nt-surface)] text-[var(--nt-text)] shadow-md transition-colors hover:bg-[var(--nt-surface2)] focus-visible:ring-2 focus-visible:ring-[var(--nt-accent)] focus-visible:ring-offset-2 ${pathname === "/trading" ? "top-3" : "top-20"}`}
    >
      {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}
