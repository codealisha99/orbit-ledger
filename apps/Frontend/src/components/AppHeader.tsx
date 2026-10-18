"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import ThemeToggle from "./ThemeToggle";
import {
  useAccount,
  useAccountMutation,
  clearAccount,
  refreshAccount,
} from "@/lib/account";
import { api } from "@/lib/client";
export default function AppHeader() {
  const path = usePathname();
  const router = useRouter();
  const account = useAccount();
  const mutation = useAccountMutation("header");
  useEffect(() => {
    if (account.unauthorized)
      router.replace(`/signin?next=${encodeURIComponent(path)}`);
  }, [account.unauthorized, path, router]);
  async function logout() {
    await api("session/logout", { method: "POST", body: "{}" });
    clearAccount();
    sessionStorage.removeItem("orbit-pending");
    localStorage.removeItem("token");
    localStorage.removeItem("userID");
    router.replace("/signin");
  }
  return (
    <>
      <header className="app-header">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            O
          </span>
          OrbitLedger
        </Link>
        <nav aria-label="Main navigation">
          <Link
            href="/trading"
            aria-current={path === "/trading" ? "page" : undefined}
          >
            Trade
          </Link>
          <Link
            href="/dashboard"
            aria-current={path === "/dashboard" ? "page" : undefined}
          >
            Dashboard
          </Link>
        </nav>
        <div className="header-account">
          <span className="paper-tag">Paper account</span>
          <ThemeToggle />
          <button className="quiet" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      {mutation.pending && (
        <div className="notice" role="status">
          A saved paper account request needs reconciliation. Its original
          details are preserved.{" "}
          <button
            disabled={mutation.busy}
            onClick={() => void mutation.retry()}
          >
            {mutation.busy ? "Reconciling…" : "Reconcile saved request"}
          </button>
        </div>
      )}
      {account.error && !account.unauthorized && (
        <div className="notice error" role="alert">
          {account.error}{" "}
          <button onClick={() => void refreshAccount()}>Retry account</button>
          {account.summary && " Showing the last successful account read."}
        </div>
      )}
    </>
  );
}
