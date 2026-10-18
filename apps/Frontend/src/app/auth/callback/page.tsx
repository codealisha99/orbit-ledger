"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function AuthCallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");
    const userId = searchParams.get("userId");
    const error = searchParams.get("error");

    if (error) {
      setStatus("error");
      const errorMessages: Record<string, string> = {
        no_code: "Authentication was cancelled or failed",
        token_failed: "Failed to verify your account",
        no_email: "Could not retrieve email from provider",
        oauth_failed: "Authentication failed. Please try again.",
      };
      setErrorMessage(errorMessages[error] || "Authentication failed");
      setTimeout(() => { router.push(`/signin?error=${error}`); }, 2000);
      return;
    }

    if (token && userId) {
      setStatus("success");
      localStorage.setItem("token", token);
      localStorage.setItem("userID", userId);
      setTimeout(() => { router.push("/trading"); }, 1000);
    } else {
      setStatus("error");
      setErrorMessage("Missing authentication data");
      setTimeout(() => { router.push("/signin?error=no_token"); }, 2000);
    }
  }, [searchParams, router]);

  return (
    <div className="w-full min-h-screen relative overflow-hidden bg-[var(--nt-bg)]">
      <div className="fixed inset-0 bg-[var(--nt-bg)]">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-gradient-to-br from-[color:color-mix(in_srgb,var(--nt-accent)_8%,transparent)] via-[#0284c7]/4 to-transparent blur-3xl"></div>
        <div className="absolute top-1/3 right-1/4 w-80 h-80 bg-gradient-to-bl from-[color:color-mix(in_srgb,var(--nt-accent)_6%,transparent)] via-[#0369a1]/3 to-transparent blur-3xl"></div>
        <div className="absolute bottom-1/4 left-1/3 w-72 h-72 bg-gradient-to-tr from-[color:color-mix(in_srgb,var(--nt-border)_10%,transparent)] via-[color:color-mix(in_srgb,var(--nt-accent)_4%,transparent)] to-transparent blur-3xl"></div>

        <div className="absolute top-20 left-10 w-32 h-32 border border-[color:color-mix(in_srgb,var(--nt-accent)_10%,transparent)] rounded-xl backdrop-blur-sm bg-[color:color-mix(in_srgb,var(--nt-accent)_3%,transparent)] animate-pulse"></div>
        <div className="absolute top-40 right-20 w-28 h-28 border border-[color:color-mix(in_srgb,var(--nt-accent)_10%,transparent)] rounded-xl backdrop-blur-sm bg-[color:color-mix(in_srgb,var(--nt-accent)_3%,transparent)] animate-pulse" style={{ animationDelay: "1s" }}></div>
        <div className="absolute bottom-32 left-1/4 w-24 h-24 border border-[color:color-mix(in_srgb,var(--nt-border)_20%,transparent)] rounded-xl backdrop-blur-sm bg-[color:color-mix(in_srgb,var(--nt-accent)_3%,transparent)] animate-pulse" style={{ animationDelay: "2s" }}></div>

        <div className="absolute inset-0 bg-[linear-gradient(rgba(14,165,233,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(14,165,233,0.03)_1px,transparent_1px)] bg-[size:40px_40px]"></div>
      </div>

      <div className="relative z-10 w-full min-h-screen flex justify-center items-center p-4">
        <div className="relative w-full max-w-md">
          <div className="relative bg-[color:color-mix(in_srgb,var(--nt-surface)_80%,transparent)] backdrop-blur-xl border border-[var(--nt-border)] rounded-2xl shadow-[0_0_40px_rgba(14,165,233,0.1)] overflow-hidden">
            <div className="p-12 text-center">
              {status === "loading" && (
                <>
                  <div className="w-16 h-16 bg-[var(--nt-accent)] rounded-xl flex items-center justify-center mx-auto mb-6 shadow-[0_0_20px_rgba(14,165,233,0.4)]">
                    <div className="animate-spin h-8 w-8 border-2 border-[var(--nt-border)] border-t-transparent rounded-full"></div>
                  </div>
                  <h1 className="text-2xl font-bold text-[var(--nt-text)] mb-2">Completing Sign In</h1>
                  <p className="text-[var(--nt-muted)]">Please wait while we verify your account...</p>
                </>
              )}

              {status === "success" && (
                <>
                  <div className="w-16 h-16 bg-green-500 rounded-xl flex items-center justify-center mx-auto mb-6">
                    <span className="text-[var(--nt-text)] text-3xl">✓</span>
                  </div>
                  <h1 className="text-2xl font-bold text-[var(--nt-text)] mb-2">Success!</h1>
                  <p className="text-[var(--nt-muted)]">Redirecting you to trading...</p>
                </>
              )}

              {status === "error" && (
                <>
                  <div className="w-16 h-16 bg-red-500 rounded-xl flex items-center justify-center mx-auto mb-6">
                    <span className="text-[var(--nt-text)] text-3xl">✕</span>
                  </div>
                  <h1 className="text-2xl font-bold text-[var(--nt-text)] mb-2">Authentication Failed</h1>
                  <p className="text-[var(--nt-muted)] mb-4">{errorMessage}</p>
                  <p className="text-[var(--nt-dim)] text-sm">Redirecting to sign in...</p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <AuthCallbackContent />
    </Suspense>
  );
}
