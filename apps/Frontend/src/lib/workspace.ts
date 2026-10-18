"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./client";
import type { Symbol } from "./market";
export interface PriceAlert {
  id: string;
  asset: Symbol;
  targetPrice: number;
  direction: "above" | "below";
  triggeredAt: string | null;
  createdAt: string;
}
export interface Workspace {
  profile: {
    userId: string;
    email: string;
    provider: string | null;
    createdAt: string;
  };
  watchlist: Symbol[];
  alerts: PriceAlert[];
}
export function useWorkspace() {
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const revision = useRef(0);
  const load = useCallback(async () => {
    const request = ++revision.current;
    const next = await api<Workspace>("user/workspace");
    if (mounted.current && request === revision.current) {
      setData(next);
      setError(null);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load().catch((e) => {
      if (mounted.current) setError(e.message);
    });
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        await api("user/workspace/check-alerts", {
          method: "POST",
          body: "{}",
        });
        await load();
      } catch (e) {
        if (mounted.current) setError((e as Error).message);
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(() => void check(), 10000);
    document.addEventListener("visibilitychange", check);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [load]);
  async function save(path: string, body: unknown) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      await load();
      return true;
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return {
    data,
    error,
    busy,
    save,
    retry: () => void load().catch((e) => setError(e.message)),
  };
}
