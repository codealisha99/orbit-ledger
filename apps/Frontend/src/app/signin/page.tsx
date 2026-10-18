"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { submitsignin } from "@/api/trade";
import { useEffect, useState, Suspense } from "react";
import OAuthButtons from "@/components/OAuthButtons";

function SigninContent() {
  const [error, setError] = useState("");
  const [submitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const oauthError = searchParams.get("error");
    if (oauthError) {
      const errorMessages: Record<string, string> = {
        no_code: "Authentication was cancelled",
        token_failed: "Failed to verify your account",
        no_email: "Could not retrieve email from provider",
        oauth_failed: "Authentication failed. Please try again.",
        no_token: "Authentication failed. Please try again.",
      };
      setError(errorMessages[oauthError] || "Authentication failed");
    }

    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = "auto"; };
  }, [searchParams]);

  const handlesubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    setIsSubmitted(true);
    setIsLoading(true);
    e.preventDefault();
    const formdata = new FormData(e.currentTarget);
    const email = formdata.get("mail");
    const pass = formdata.get("pass");

    if (!email || !pass) {
      setIsLoading(false);
      setIsSubmitted(false);
      return;
    }

    const data = await submitsignin(email as string, pass as string);

    if (data.token && data.userId) {
      localStorage.setItem("userID", data.userId);
      localStorage.setItem("token", data.token);
      router.push("/trading");
      setIsSubmitted(false);
      setIsLoading(false);
    } else {
      setIsSubmitted(false);
      setIsLoading(false);
      setError(data.error || data.message || "Sign in failed");
    }
  };

  return (
    <div className="w-full min-h-screen relative overflow-hidden bg-[#050f1a]">
      <div className="fixed inset-0 bg-[#050f1a]">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-gradient-to-br from-[#0EA5E9]/8 via-[#0284c7]/4 to-transparent blur-3xl"></div>
        <div className="absolute top-1/3 right-1/4 w-80 h-80 bg-gradient-to-bl from-[#0EA5E9]/6 via-[#0369a1]/3 to-transparent blur-3xl"></div>
        <div className="absolute bottom-1/4 left-1/3 w-72 h-72 bg-gradient-to-tr from-[#1e3a5f]/10 via-[#0EA5E9]/4 to-transparent blur-3xl"></div>

        <div className="absolute top-20 left-10 w-32 h-32 border border-[#0EA5E9]/10 rounded-xl backdrop-blur-sm bg-[#0EA5E9]/3 animate-pulse"></div>
        <div className="absolute top-40 right-20 w-28 h-28 border border-[#0EA5E9]/10 rounded-xl backdrop-blur-sm bg-[#0EA5E9]/3 animate-pulse" style={{ animationDelay: "1s" }}></div>
        <div className="absolute bottom-32 left-1/4 w-24 h-24 border border-[#1e3a5f]/20 rounded-xl backdrop-blur-sm bg-[#0EA5E9]/3 animate-pulse" style={{ animationDelay: "2s" }}></div>

        <div className="absolute inset-0 bg-[linear-gradient(rgba(14,165,233,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(14,165,233,0.03)_1px,transparent_1px)] bg-[size:40px_40px]"></div>
      </div>

      <div className="relative z-10 w-full min-h-screen flex justify-center items-center p-4">
        <div className="relative w-full max-w-md">
          <div className="relative bg-[#0a1929]/80 backdrop-blur-xl border border-[#1e3a5f] rounded-2xl shadow-[0_0_40px_rgba(14,165,233,0.1)] overflow-hidden">
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-[#0EA5E9] rounded-xl flex items-center justify-center mx-auto mb-4 shadow-[0_0_20px_rgba(14,165,233,0.4)]">
                <span className="text-white text-2xl font-bold">→</span>
              </div>
              <h1 className="text-3xl font-bold text-[#e2e8f0] mb-2">Welcome Back</h1>
              <p className="text-[#94a3b8]">Sign in to continue trading</p>
            </div>

            <div className="px-8 pb-8 space-y-4">
              <form onSubmit={handlesubmit} className="space-y-4">
                <div className="relative group">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                    <span className="text-[#94a3b8] group-focus-within:text-[#0EA5E9] transition-colors duration-300">@</span>
                  </div>
                  <input
                    type="email"
                    name="mail"
                    placeholder="Email"
                    className="w-full pl-10 pr-4 py-3 bg-[#050f1a]/50 border border-[#1e3a5f] rounded-lg text-[#e2e8f0] placeholder-[#64748b] focus:outline-none focus:border-[#0EA5E9] focus:bg-[#0d2137]/50 transition-all duration-300"
                  />
                </div>

                <div className="relative group">
                  <div className="absolute left-3 top-1/2 transform -translate-y-1/2">
                    <span className="text-[#94a3b8] group-focus-within:text-[#0EA5E9] transition-colors duration-300">🔒</span>
                  </div>
                  <input
                    type="password"
                    name="pass"
                    placeholder="Enter Password"
                    className="w-full pl-10 pr-4 py-3 bg-[#050f1a]/50 border border-[#1e3a5f] rounded-lg text-[#e2e8f0] placeholder-[#64748b] focus:outline-none focus:border-[#0EA5E9] focus:bg-[#0d2137]/50 transition-all duration-300"
                  />
                </div>

                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm text-center">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitted}
                  className="w-full py-3 bg-[#0EA5E9] hover:bg-[#0284c7] text-white font-semibold rounded-lg transform transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-[0_0_20px_rgba(14,165,233,0.3)]"
                >
                  {isLoading ? (
                    <div className="flex items-center">
                      <div className="animate-spin h-5 w-5 border-b-2 border-white mr-2"></div>
                      Signing In...
                    </div>
                  ) : (
                    <>
                      <span className="mr-2">→</span>
                      Sign In
                    </>
                  )}
                </button>
              </form>

              <OAuthButtons disabled={submitted} />

              <div className="text-center">
                <p className="text-[#94a3b8] text-sm">
                  Don&apos;t have an account?{" "}
                  <button
                    onClick={() => {
                      localStorage.removeItem("token");
                      localStorage.removeItem("userID");
                      router.push("/signup");
                    }}
                    className="text-[#0EA5E9] hover:text-[#38bdf8] font-medium transition-colors duration-300"
                  >
                    Sign Up
                  </button>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SigninPage() {
  return (
    <Suspense>
      <SigninContent />
    </Suspense>
  );
}
