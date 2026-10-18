"use client";

import { useRouter } from "next/navigation";
import { submitsignup } from "@/api/trade";
import { useEffect, useState } from "react";
import OAuthButtons from "@/components/OAuthButtons";

export default function SignupPage() {
  const [error, setError] = useState("");
  const [submitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const loggedin = localStorage.getItem("userID") !== null;
    if (loggedin) router.push("/signin");

    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = "auto"; };
  }, [router]);

  const handlesubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    setIsSubmitted(true);
    setIsLoading(true);
    e.preventDefault();
    const formdata = new FormData(e.currentTarget);
    const email = formdata.get("mail");
    const pass = formdata.get("pass");

    if (!email || !pass) {
      setIsSubmitted(false);
      setIsLoading(false);
      return;
    }

    const data = await submitsignup(email as string, pass as string);

    if (data.userId && data.token) {
      localStorage.setItem("userID", data.userId);
      localStorage.setItem("token", data.token);
      router.push("/trading");
      setIsSubmitted(false);
      setIsLoading(false);
    } else {
      setIsSubmitted(false);
      setIsLoading(false);
      const errorMessage = data.error || data.message || "Failed to create account";
      setError(errorMessage);

      if (errorMessage.toLowerCase().includes("already exists")) {
        setTimeout(() => {
          if (window.confirm("This email is already registered. Would you like to sign in instead?")) {
            router.push("/signin");
          }
        }, 500);
      }
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
                <span className="text-white text-2xl font-bold">+</span>
              </div>
              <h1 className="text-3xl font-bold text-[#e2e8f0] mb-2">Create Account</h1>
              <p className="text-[#94a3b8]">Join OrbitLedger today</p>
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
                    placeholder="Password (min. 6 characters)"
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
                      Creating Account...
                    </div>
                  ) : (
                    "Create Account →"
                  )}
                </button>
              </form>

              <OAuthButtons disabled={submitted} />

              <div className="text-center">
                <p className="text-[#94a3b8] text-sm">
                  Already have an account?{" "}
                  <button
                    onClick={() => router.push("/signin")}
                    className="text-[#0EA5E9] hover:text-[#38bdf8] font-medium transition-colors duration-300"
                  >
                    Sign in
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
