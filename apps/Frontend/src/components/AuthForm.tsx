"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, signInDestination } from "@/lib/client";
import { clearAccount } from "@/lib/account";
import OAuthButtons from "./OAuthButtons";
import ThemeToggle from "./ThemeToggle";
import { PaperShipIcon } from "./PaperShipLogo";
export default function AuthForm({ signup = false }: { signup?: boolean }) {
  const router = useRouter();
  const [next, setNext] = useState("/dashboard");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setNext(signInDestination());
    localStorage.removeItem("token");
    const search = new URLSearchParams(location.search);
    const errCode = search.get("error");
    const errEmail = search.get("email");
    if (errCode) {
      if (errCode === "access_denied") {
        setError("Sign-in was cancelled with the provider.");
      } else if (errCode === "invalid_state") {
        setError("Authentication session expired or security check failed. Please try again.");
      } else if (errCode === "unverified_email") {
        setError("Your provider email is not verified. Please verify your email with Google or GitHub first.");
      } else if (errCode === "account_exists_link_required") {
        setError(
          errEmail
            ? `An account for ${errEmail} already exists. Sign in with your password to link this provider in Account settings.`
            : "An account with this email already exists. Sign in with your password to link your provider in Account settings.",
        );
        if (errEmail) setEmail(errEmail);
      } else if (errCode === "no_email") {
        setError("The provider did not provide a verified email. A verified email is required.");
      } else if (errCode === "token_failed") {
        setError("Could not complete secure code exchange with the provider. Please try again.");
      } else {
        setError("Provider sign-in could not be completed. Use your original sign-in method or try again.");
      }
    }
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`user/${signup ? "signup" : "signin"}`, {
        method: "POST",
        body: JSON.stringify({
          email: signup ? email.trim().toLowerCase() : email.trim(),
          password,
        }),
      });
      clearAccount();
      router.replace(signInDestination());
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-theme">
        <ThemeToggle />
      </div>
      <div className="auth-card">
        <Link href="/" className="brand" aria-label="Paper Ship home">
          <span className="brand-mark" aria-hidden="true">
            <PaperShipIcon size={20} />
          </span>
          Paper Ship
        </Link>
        <h1>{signup ? "Start your paper account" : "Welcome back"}</h1>
        <p>
          {signup
            ? "Practice with virtual USD. No deposit or payment details required."
            : "Sign in to your paper trading account."}
        </p>
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <legend className="sr-only">
              {signup ? "Create account" : "Sign in"}
            </legend>
            <label htmlFor="email">
              Email address
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label htmlFor="password">
              Password
              <input
                id="password"
                type="password"
                autoComplete={signup ? "new-password" : "current-password"}
                minLength={signup ? 12 : 1}
                maxLength={signup ? 72 : 1024}
                required
                placeholder={signup ? "At least 12 characters" : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby="auth-error"
              />
            </label>
            {error && (
              <p className="notice error" id="auth-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" type="submit">
              {busy
                ? "Please wait…"
                : signup
                  ? "Create paper account"
                  : "Sign in"}
            </button>
          </fieldset>
        </form>
        <OAuthButtons disabled={busy} />
        <p>
          {signup ? "Already have an account?" : "New to Paper Ship?"}{" "}
          <Link
            href={`${signup ? "/signin" : "/signup"}?next=${encodeURIComponent(next)}`}
          >
            {signup ? "Sign in" : "Create a paper account"}
          </Link>
        </p>
      </div>
    </main>
  );
}
