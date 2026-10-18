"use client";
import { useEffect, useRef, useState } from "react";
import type { Symbol } from "@/lib/market";
import { X, Bell } from "lucide-react";
export default function AlertDialog({
  onClose,
  onSave,
  busy,
  error,
}: {
  onClose: () => void;
  onSave: (body: {
    id: string;
    asset: Symbol;
    direction: "above" | "below";
    targetPrice: number;
  }) => Promise<boolean>;
  busy: boolean;
  error: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const [asset, setAsset] = useState<Symbol>("BTC");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [price, setPrice] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector("input")?.focus();
    const d = dialog.current;
    return () => d?.close();
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const fingerprint = JSON.stringify({ asset, direction, price });
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, id: crypto.randomUUID() };
    if (
      await onSave({
        id: request.current.id,
        asset,
        direction,
        targetPrice: Number(price),
      })
    )
      onClose();
  }
  return (
    <dialog
      ref={dialog}
      className="position-dialog alert-dialog"
      aria-labelledby="alert-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <div className="dialog-heading">
        <div>
          <Bell size={20} />
          <h2 id="alert-title">Create a price alert</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close alert dialog"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <p className="muted">
        Save a level to keep an eye on. Alerts check fresh exchange prices every
        10 seconds while your Dashboard is open.
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Market
            <select
              value={asset}
              onChange={(e) => setAsset(e.target.value as Symbol)}
            >
              <option>BTC</option>
              <option>ETH</option>
              <option>SOL</option>
            </select>
          </label>
          <label>
            Notify when price is
            <select
              value={direction}
              onChange={(e) =>
                setDirection(e.target.value as "above" | "below")
              }
            >
              <option value="above">At or above</option>
              <option value="below">At or below</option>
            </select>
          </label>
          <label>
            Target price (USD)
            <input
              autoFocus
              type="number"
              min="0.0001"
              max="1000000000"
              step="0.0001"
              inputMode="decimal"
              required
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="e.g. 85000"
            />
          </label>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <p className="alert-disclaimer">
            In-app only. No email, push notification, or automated trade. If the
            price already meets your level, the alert triggers on its next
            check.
          </p>
          <button className="primary" type="submit">
            {busy ? "Saving…" : "Save alert"}
          </button>
        </fieldset>
      </form>
    </dialog>
  );
}
