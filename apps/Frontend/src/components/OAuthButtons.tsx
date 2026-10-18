"use client";
import { useEffect, useState } from "react";
import { api, signInDestination } from "@/lib/client";
export default function OAuthButtons({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const [providers, setProviders] = useState<{
    google: boolean;
    github: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    void api<{ google: boolean; github: boolean }>("auth/status")
      .then(setProviders)
      .catch(() => setProviders({ google: false, github: false }));
  }, []);
  return (
    <>
      <p>Or use a connected provider</p>
      <div className="oauth-buttons">
        {(["google", "github"] as const).map((provider) => (
          <button
            type="button"
            disabled={disabled || loading || !providers?.[provider]}
            key={provider}
            onClick={() => {
              setLoading(true);
              sessionStorage.setItem("orbit-auth-next", signInDestination());
              location.href = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v2"}/auth/${provider}`;
            }}
          >
            {provider === "google" ? "Google" : "GitHub"}
            {providers && !providers[provider] ? " · unavailable" : ""}
          </button>
        ))}
      </div>
    </>
  );
}
