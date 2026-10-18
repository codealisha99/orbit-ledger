"use client";
import { useEffect, useRef, useState } from "react";
import { money } from "@orbitledger/shared";
import { type Position, useAccountMutation } from "@/lib/account";
export interface PositionAction {
  kind: "close" | "partial-close" | "add-margin" | "protection";
  position: Position;
}
export default function PositionDialog({
  action,
  onClose,
  mutation,
}: {
  action: PositionAction | null;
  onClose: () => void;
  mutation: ReturnType<typeof useAccountMutation>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [amount, setAmount] = useState("");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  useEffect(() => {
    if (action) {
      setAmount(action.kind === "partial-close" ? "50" : "");
      setTp(
        action.position.takeProfit
          ? String(action.position.takeProfit / 10000)
          : "",
      );
      setSl(
        action.position.stopLoss
          ? String(action.position.stopLoss / 10000)
          : "",
      );
      dialog.current?.showModal();
    }
  }, [action]);
  async function manage(e: React.FormEvent) {
    e.preventDefault();
    if (!action) return;
    const result = await mutation.execute(`trade/${action.kind}`, {
      orderId: action.position.orderId,
      ...(action.kind === "partial-close"
        ? { percentage: Number(amount) }
        : action.kind === "add-margin"
          ? { additionalMargin: Number(amount) }
          : action.kind === "protection"
            ? {
                takeProfit: tp ? Number(tp) : null,
                stopLoss: sl ? Number(sl) : null,
              }
            : {}),
    });
    if (result) {
      dialog.current?.close();
      onClose();
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="position-dialog-title"
      onCancel={(e) => {
        if (mutation.busy || mutation.pending) e.preventDefault();
        else onClose();
      }}
      onClose={() => {
        if (!mutation.busy && !mutation.pending) onClose();
      }}
    >
      <form onSubmit={manage}>
        <div className="section-heading">
          <h2 id="position-dialog-title">
            {action?.kind === "close"
              ? "Close position"
              : action?.kind === "partial-close"
                ? "Close part of position"
                : action?.kind === "add-margin"
                  ? "Add collateral"
                  : "Edit protection"}
          </h2>
          <button
            type="button"
            aria-label="Close dialog"
            disabled={mutation.busy || !!mutation.pending}
            onClick={() => {
              dialog.current?.close();
              onClose();
            }}
          >
            ×
          </button>
        </div>
        <p>
          {action?.position.asset}{" "}
          {action?.position.type === "buy" ? "long" : "short"} ·{" "}
          {action && money(action.position.margin)} collateral
        </p>
        {action?.kind === "close" && (
          <p>
            This closes the remaining quantity at a fresh simulated quote. Gross
            P&L is reduced by the exit fee. The final quote may change before
            execution.
          </p>
        )}
        {(action?.kind === "partial-close" ||
          action?.kind === "add-margin") && (
          <label>
            {action.kind === "partial-close"
              ? "Percentage to close (1–99%)"
              : "Additional collateral (USD)"}
            <input
              autoFocus
              type="number"
              value={amount}
              min={action.kind === "partial-close" ? 1 : 10}
              max={action.kind === "partial-close" ? 99 : 1000000}
              step="0.01"
              required
              disabled={mutation.busy || !!mutation.pending}
              onChange={(e) => setAmount(e.target.value)}
            />
            <small>
              {action.kind === "add-margin"
                ? "Quantity stays unchanged. Added collateral incurs a 0.5% fee."
                : "Collateral and remaining exposure decrease proportionally. An exit fee applies."}
            </small>
          </label>
        )}
        {action?.kind === "protection" && (
          <>
            {[
              ["Take profit", tp, setTp],
              ["Stop loss", sl, setSl],
            ].map(([label, value, set]) => (
              <label key={String(label)}>
                {String(label)} (USD)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={String(value)}
                  disabled={mutation.busy || !!mutation.pending}
                  onChange={(e) => (set as (v: string) => void)(e.target.value)}
                  placeholder="Off"
                />
              </label>
            ))}
            <small>Clear a field to remove its level.</small>
          </>
        )}
        {mutation.error && (
          <p className="notice error" role="alert">
            {mutation.error}
          </p>
        )}
        {mutation.pending ? (
          <button
            type="button"
            className="primary"
            disabled={mutation.busy}
            onClick={() => {
              void mutation.retry()?.then((result) => {
                if (result) {
                  dialog.current?.close();
                  onClose();
                }
              });
            }}
          >
            {mutation.busy ? "Reconciling…" : "Retry saved request safely"}
          </button>
        ) : (
          <button className="primary" disabled={mutation.busy}>
            {mutation.busy ? "Submitting…" : "Confirm paper account change"}
          </button>
        )}
      </form>
    </dialog>
  );
}
