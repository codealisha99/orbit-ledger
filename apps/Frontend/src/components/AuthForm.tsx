"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, signInDestination } from "@/lib/client";
import { clearAccount } from "@/lib/account";
import OAuthButtons from "./OAuthButtons";
import ThemeToggle from "./ThemeToggle";
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
    localStorage.removeItem("userID");
    if (new URLSearchParams(location.search).has("error"))
      setError(
        "Provider sign-in could not be completed. Use your original sign-in method or try again.",
      );
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
        <Link href="/" className="brand">
          <span className="brand-mark">O</span>OrbitLedger
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
          {signup ? "Already have an account?" : "New to OrbitLedger?"}{" "}
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
