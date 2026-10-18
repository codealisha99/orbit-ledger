"use client";
import { useEffect, useSyncExternalStore } from "react";
import { api, ApiError, mutation } from "./client";

export interface Position {
  feesRecorded: boolean;
  needsReview: boolean;
  orderId: string;
  asset: "BTC" | "ETH" | "SOL";
  type: "buy" | "sell";
  margin: number;
  initialMargin: number;
  addedMargin: number;
  leverage: number;
  effectiveLeverage: number;
  notionalCents: number;
  quantity: number;
  entryFeeCents: number;
  openPrice: number;
  markPrice: number | null;
  pnlCents: number | null;
  liquidationPrice: number;
  takeProfit: number | null;
  stopLoss: number | null;
  openedAt: string;
  stale: boolean;
  trailingStopLossEnabled: boolean;
  trailingStopLossDistance: number | null;
}
export interface Summary {
  userId: string;
  version: number;
  availableCents: number;
  reservedCents: number;
  openPnlCents: number | null;
  equityCents: number | null;
  stale: boolean;
  valuedAt: number;
  orders: Position[];
}
export interface Execution extends Omit<Position, "pnlCents"> {
  feesRecorded: boolean;
  positionId: string;
  closePrice: number;
  closedAt: string;
  pnl: number;
  netPnlCents: number | null;
  exitFeeCents: number;
  closeReason: string;
}
export interface AccountEvent {
  id: string;
  version: number;
  kind: string;
  positionId: string;
  createdAt: string;
  payload: unknown;
}
type State = {
  summary: Summary | null;
  loading: boolean;
  error: string | null;
  unauthorized: boolean;
  events: AccountEvent[];
};
const initial: State = {
  summary: null,
  loading: true,
  error: null,
  unauthorized: false,
  events: [],
};
let state = initial;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let active = false;
let generation = 0;
let cursor = 0;
let pollEpoch = 0;
let failures = 0;
function emit(next: State) {
  state = next;
  listeners.forEach((fn) => fn());
}
export async function refreshAccount() {
  if (active) return;
  active = true;
  const requestGeneration = generation;
  try {
    const summary = await api<Summary>("trade/summary");
    const collected: AccountEvent[] = [];
    let after = cursor;
    for (let page = 0; page < 10; page++) {
      if (summary.version <= after) break;
      const result = await api<{ events: AccountEvent[] }>(
        `trade/events?after=${after}`,
      );
      collected.push(...result.events);
      after = result.events.at(-1)?.version ?? after;
      if (result.events.length < 100) break;
    }
    if (generation !== requestGeneration) return;
    cursor = after;
    failures = 0;
    emit({
      summary,
      loading: false,
      error: null,
      unauthorized: false,
      events: [...state.events, ...collected].slice(-200),
    });
  } catch (error) {
    if (generation !== requestGeneration) return;
    failures++;
    emit({
      ...state,
      loading: false,
      error: (error as Error).message,
      unauthorized:
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403),
    });
  } finally {
    active = false;
  }
}
async function poll(epoch: number) {
  if (epoch !== pollEpoch) return;
  if (document.visibilityState === "visible") await refreshAccount();
  if (listeners.size && epoch === pollEpoch)
    timer = setTimeout(
      () => void poll(epoch),
      Math.min(30000, 1000 * 2 ** Math.min(failures, 5)),
    );
}
const resume = () => {
  if (document.visibilityState === "visible") void refreshAccount();
};
function subscribe(fn: () => void) {
  listeners.add(fn);
  if (listeners.size === 1) {
    void poll(++pollEpoch);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("orbit-account-event", resume);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      pollEpoch++;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("orbit-account-event", resume);
    }
  };
}
export function useAccount() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => initial,
  );
}
export function clearAccount() {
  generation++;
  cursor = 0;
  failures = 0;
  emit(initial);
  restored = false;
  emitMutation(emptyMutation);
}

interface Pending {
  key: string;
  path: string;
  body: unknown;
  owner: string;
  userId: string;
}
interface MutationState {
  pending: Pending | null;
  busy: boolean;
  error: string | null;
  receipt: {
    eventId: string;
    version: number;
    receiptId?: string;
    positionId: string;
  } | null;
  owner: string;
}
const emptyMutation: MutationState = {
  pending: null,
  busy: false,
  error: null,
  receipt: null,
  owner: "",
};
let mutationState = emptyMutation;
let restored = false;
const mutationListeners = new Set<() => void>();
function emitMutation(next: MutationState) {
  mutationState = next;
  mutationListeners.forEach((fn) => fn());
}
function subscribeMutation(fn: () => void) {
  mutationListeners.add(fn);
  return () => {
    mutationListeners.delete(fn);
  };
}
export function useAccountMutation(owner: string) {
  const current = useSyncExternalStore(
    subscribeMutation,
    () => mutationState,
    () => emptyMutation,
  );
  useEffect(() => {
    if (restored) return;
    restored = true;
    const saved = sessionStorage.getItem("orbit-pending");
    if (saved) {
      try {
        const pending = JSON.parse(saved) as Pending;
        emitMutation({
          ...emptyMutation,
          pending,
          owner: pending.owner,
          error:
            "A previous submission needs reconciliation. Retry the saved request safely.",
        });
      } catch {
        sessionStorage.removeItem("orbit-pending");
      }
    }
  }, []);
  async function execute(path: string, body: unknown) {
    if (mutationState.busy) return;
    const userId = state.summary?.userId;
    if (!userId) return;
    if (mutationState.pending && mutationState.pending.userId !== userId) {
      emitMutation({
        ...emptyMutation,
        error:
          "The saved request belongs to another account. Sign into that account to reconcile it.",
        owner,
      });
      return;
    }
    const request = mutationState.pending ?? {
      key: crypto.randomUUID(),
      path,
      body,
      owner,
      userId,
    };
    sessionStorage.setItem("orbit-pending", JSON.stringify(request));
    emitMutation({
      ...emptyMutation,
      pending: request,
      busy: true,
      owner: request.owner,
    });
    try {
      const receipt = await mutation<{
        eventId: string;
        version: number;
        receiptId?: string;
        positionId: string;
      }>(request.path, request.body, request.key);
      sessionStorage.removeItem("orbit-pending");
      emitMutation({ ...emptyMutation, receipt, owner: request.owner });
      await refreshAccount();
      return receipt;
    } catch (err) {
      const definitive =
        err instanceof ApiError &&
        ((err.status >= 400 &&
          err.status < 500 &&
          ![401, 403, 408, 429].includes(err.status)) ||
          err.code === "QUOTE_UNAVAILABLE");
      if (definitive) sessionStorage.removeItem("orbit-pending");
      emitMutation({
        ...emptyMutation,
        owner: request.owner,
        error: (err as Error).message,
        pending: definitive ? null : request,
      });
    }
  }
  return {
    execute,
    pending: current.pending,
    busy: current.busy,
    error: current.owner === owner ? current.error : null,
    receipt: current.owner === owner ? current.receipt : null,
    retry: () =>
      current.pending && execute(current.pending.path, current.pending.body),
  };
}
