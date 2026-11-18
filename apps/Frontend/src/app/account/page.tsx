"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "../dashboard/dashboard.css";
import { useEffect, useState } from "react";
import {
  Download,
  ShieldCheck,
  ArrowUpRight,
  UserRound,
  KeyRound,
  Link2,
  Unlink,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/client";
import { clearAccount, useAccount } from "@/lib/account";
import type { Workspace } from "@/lib/workspace";

interface Identity {
  id: string;
  provider: string;
  providerAccountId: string;
  email: string | null;
  createdAt: string;
}

interface AuthMethods {
  hasPassword: boolean;
  email: string;
  identities: Identity[];
}

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
      sessionStorage.removeItem("papership-pending");
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
  const [notice, setNotice] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const [authMethods, setAuthMethods] = useState<AuthMethods | null>(null);
  const [providerConfig, setProviderConfig] = useState<{ google: boolean; github: boolean } | null>(null);
  const [unlinking, setUnlinking] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const linked = params.get("linked");
    const err = params.get("error");
    if (linked) {
      setNotice(`Successfully connected ${linked.toUpperCase()} to your account.`);
      history.replaceState(null, "", "/account");
    } else if (err) {
      setError(decodeURIComponent(err));
      history.replaceState(null, "", "/account");
    }
  }, []);

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

    api<AuthMethods>("auth/identities", { signal: abort.signal })
      .then((data) => setAuthMethods(data))
      .catch(() => {});

    api<{ google: boolean; github: boolean }>("auth/status", { signal: abort.signal })
      .then((data) => setProviderConfig(data))
      .catch(() => {});

    return () => abort.abort();
  }, [account.summary?.userId, retry]);

  async function unlinkProvider(provider: "google" | "github") {
    if (!authMethods) return;
    if (!authMethods.hasPassword && authMethods.identities.length <= 1) {
      setError("Cannot disconnect your only sign-in method. Set a password or connect another provider first.");
      return;
    }

    setUnlinking(provider);
    setError(null);
    try {
      await api(`auth/identities/${provider}`, { method: "DELETE" });
      setNotice(`Disconnected ${provider.toUpperCase()} from your account.`);
      setRetry((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUnlinking(null);
    }
  }

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
    a.download = "papership-workspace.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const googleLinked = authMethods?.identities.some((i) => i.provider === "google");
  const githubLinked = authMethods?.identities.some((i) => i.provider === "github");

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

        {notice && (
          <div className="notice success" role="status">
            <CheckCircle2 size={16} />
            {notice}
          </div>
        )}

        {error && (
          <div className="notice error" role="alert">
            <AlertCircle size={16} />
            {error}
            <button onClick={() => setRetry((n) => n + 1)}>
              Retry
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
                    <dt>Primary method</dt>
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

          <section className="surface account-details">
            <div className="section-heading">
              <h2>
                <KeyRound size={18} />
                Connected sign-in methods
              </h2>
              <span>Multi-provider</span>
            </div>

            <dl className="trade-preview">
              <div>
                <dt>Password</dt>
                <dd>{authMethods?.hasPassword ? "Active" : "Not configured"}</dd>
              </div>

              <div>
                <dt>Google</dt>
                <dd style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {googleLinked ? (
                    <>
                      <span className="paper-tag">Connected</span>
                      <button
                        className="quiet"
                        disabled={unlinking === "google"}
                        onClick={() => void unlinkProvider("google")}
                        title="Disconnect Google sign-in"
                      >
                        <Unlink size={13} />
                        {unlinking === "google" ? "Disconnecting…" : "Disconnect"}
                      </button>
                    </>
                  ) : (
                    <button
                      className="quiet"
                      disabled={!providerConfig?.google}
                      title={providerConfig?.google ? "Connect your Google account" : "Google OAuth not configured in server environment"}
                      onClick={() => {
                        location.href = "/api/oauth/google?link=1";
                      }}
                    >
                      <Link2 size={13} />
                      {providerConfig?.google ? "Connect Google" : "Unavailable"}
                    </button>
                  )}
                </dd>
              </div>

              <div>
                <dt>GitHub</dt>
                <dd style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {githubLinked ? (
                    <>
                      <span className="paper-tag">Connected</span>
                      <button
                        className="quiet"
                        disabled={unlinking === "github"}
                        onClick={() => void unlinkProvider("github")}
                        title="Disconnect GitHub sign-in"
                      >
                        <Unlink size={13} />
                        {unlinking === "github" ? "Disconnecting…" : "Disconnect"}
                      </button>
                    </>
                  ) : (
                    <button
                      className="quiet"
                      disabled={!providerConfig?.github}
                      title={providerConfig?.github ? "Connect your GitHub account" : "GitHub OAuth not configured in server environment"}
                      onClick={() => {
                        location.href = "/api/oauth/github?link=1";
                      }}
                    >
                      <Link2 size={13} />
                      {providerConfig?.github ? "Connect GitHub" : "Unavailable"}
                    </button>
                  )}
                </dd>
              </div>
            </dl>
            <p className="muted">
              Connect multiple providers to sign into Paper Ship through any of your accounts. You cannot disconnect your only usable login method.
            </p>
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
