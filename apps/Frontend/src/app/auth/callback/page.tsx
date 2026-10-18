"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { clearAccount } from "@/lib/account";
export default function Callback() {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const router = useRouter();
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = new URLSearchParams(location.search).get("code");
    history.replaceState(null, "", "/auth/callback");
    if (!code) {
      setError("Sign-in information is missing. Start sign-in again.");
      return;
    }
    void api("auth/exchange", {
      method: "POST",
      body: JSON.stringify({ code }),
    })
      .then(() => {
        clearAccount();
        const next = sessionStorage.getItem("orbit-auth-next");
        sessionStorage.removeItem("orbit-auth-next");
        router.replace(
          next?.startsWith("/") &&
            !next.startsWith("//") &&
            !next.startsWith("/\\")
            ? next
            : "/trading",
        );
      })
      .catch((e) => setError(e.message));
  }, [router]);
  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1>{error ? "Sign-in needs attention" : "Completing sign-in…"}</h1>
        {error && (
          <>
            <p role="alert">{error}</p>
            <Link href="/signin">Return to sign-in</Link>
          </>
        )}
      </div>
    </main>
  );
}
