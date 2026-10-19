"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "../dashboard/dashboard.css";
import { useEffect, useState } from "react";
import { Download, ShieldCheck, ArrowUpRight, UserRound } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/client";
import { clearAccount, useAccount } from "@/lib/account";
import type { Workspace } from "@/lib/workspace";
export default function AccountPage() {
  const account = useAccount();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  async function signOutEverywhere() {
    setSigningOut(true);
    setError(null);
    try {
      await api("session/logout-all", { method: "POST", body: "{}" });
      clearAccount();
      sessionStorage.removeItem("orbit-pending");
      localStorage.removeItem("token");
      localStorage.removeItem("userID");
      router.replace("/signin");
      router.refresh();
    } catch {
      setError("Could not sign out all devices. Please retry.");
    } finally {
      setSigningOut(false);
    }
  }
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    api<Workspace>("user/workspace", { signal: abort.signal })
      .then((data) => {
        setWorkspace(data);
        setError(null);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [account.summary?.userId, retry]);
  function download() {
    if (!workspace) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { exportedAt: new Date().toISOString(), ...workspace },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "orbitledger-workspace.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="workspace">
      <AppHeader />
      <main className="dashboard-main account-home">
        <div className="page-heading">
          <div>
            <p className="dashboard-eyebrow">Your workspace, your pace</p>
            <h1>Account & guide</h1>
            <p>A few useful details before your next decision.</p>
          </div>
          <Link href="/dashboard" className="quiet">
            Back to Dashboard
            <ArrowUpRight size={16} />
          </Link>
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button onClick={() => setRetry((n) => n + 1)}>
              Retry account details
            </button>
          </div>
        )}
        <div className="account-settings-grid">
          <section className="surface account-details">
            <div className="section-heading">
              <h2>
                <UserRound size={18} />
                Your account
              </h2>
              <span>Paper trading</span>
            </div>
            {workspace ? (
              <>
                <dl className="trade-preview">
                  <div>
                    <dt>Email</dt>
                    <dd>{workspace.profile.email}</dd>
                  </div>
                  <div>
                    <dt>Sign-in method</dt>
                    <dd>
                      {workspace.profile.provider
                        ? `${workspace.profile.provider} account`
                        : "Email & password"}
                    </dd>
                  </div>
                  <div>
                    <dt>Joined</dt>
                    <dd>
                      {new Date(workspace.profile.createdAt).toLocaleDateString(
                        undefined,
                        { year: "numeric", month: "long", day: "numeric" },
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Saved markets</dt>
                    <dd>{workspace.watchlist.length}</dd>
                  </div>
                  <div>
                    <dt>Price alerts</dt>
                    <dd>{workspace.alerts.length}</dd>
                  </div>
                </dl>
                <button className="quiet download-workspace" onClick={download}>
                  <Download size={15} />
                  Download watchlist & alerts
                </button>
                <button
                  className="quiet download-workspace"
                  disabled={signingOut}
                  onClick={signOutEverywhere}
                >
                  <ShieldCheck size={15} />
                  {signingOut ? "Signing out…" : "Sign out all devices"}
                </button>
                <p className="muted">
                  A JSON copy of your saved workspace and account details. Trade
                  exports are available in your history.
                </p>
              </>
            ) : (
              <p className="empty">
                {error
                  ? "Account details unavailable."
                  : "Loading account details…"}
              </p>
            )}
          </section>
          <section className="surface account-guide">
            <div className="section-heading">
              <h2>
                <ShieldCheck size={18} />A practice environment
              </h2>
            </div>
            <p>
              Your balance is virtual USD. It has no cash value, cannot be
              withdrawn, and is never sent to an exchange.
            </p>
            <p>
              Use this space to understand trade sizing, exposure, costs, and
              your decisions. Simulated performance does not predict real
              trading results.
            </p>
            <Link className="primary" href="/trading">
              Open trading workspace
              <ArrowUpRight size={16} />
            </Link>
          </section>
        </div>
        <section className="surface mvp-guide">
          <div className="section-heading">
            <h2>How your paper account works</h2>
            <Link href="/trading?tab=history#account-activity">
              Open trade history
            </Link>
          </div>
          {[
            [
              "Cash, collateral, and equity",
              "Opening a position reserves collateral from your available cash. Equity includes available cash, reserved collateral, and gross open P&L. Adding collateral preserves exposure; a partial exit reduces exposure and collateral proportionally.",
            ],
            [
              "Spread and fees",
              "Execution quotes include a simulated 0.5% spread from the exchange price. Opening, adding collateral, and exiting each cost 0.5% of the collateral involved, rounded down to cents. Inspect estimated costs in the ticket and actual costs in receipts.",
            ],
            [
              "Protection and liquidation",
              "Stop loss, take profit, and trailing stops use fresh quotes, checked every five seconds. Liquidation takes priority. Gap fills can pass your chosen level. A position’s loss is capped at its reserved collateral.",
            ],
            [
              "Watchlists and price alerts",
              "Star BTC, ETH, or SOL to save it to your account. Alerts are checked every ten seconds against fresh exchange prices while Dashboard is open. Triggered alerts stay in your list until you remove or rearm them. No email, push notification, or automatic trade is sent.",
            ],
            [
              "History and recorded equity",
              "History includes partial exits and full closes. Receipts show their lifecycle, prices, and costs. Equity history starts when real snapshots are recorded; missing or stale valuations create gaps rather than an invented curve.",
            ],
            [
              "When the connection drops",
              "Stale prices cannot execute a trade. Account state reconciles after reconnect. If a request’s outcome is unknown, retry the saved request with its original details instead of creating another trade.",
            ],
          ].map(([title, body]) => (
            <details key={title}>
              <summary>{title}</summary>
              <p>{body}</p>
            </details>
          ))}
        </section>
        <footer className="app-footer">
          Virtual funds only. Built for learning and practice. Not investment
          advice.
        </footer>
      </main>
    </div>
  );
}
