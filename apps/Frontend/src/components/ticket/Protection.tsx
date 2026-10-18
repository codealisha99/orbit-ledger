"use client";
import { pnlCents, signedMoney } from "@orbitledger/shared";
export interface ProtectionValues {
  tp: string;
  sl: string;
  trailing: string;
}
export default function Protection({
  values,
  onChange,
  price,
  side,
  exposure,
  collateral,
  fee,
  liquidation,
}: {
  values: ProtectionValues;
  onChange: (v: ProtectionValues) => void;
  price: number;
  side: "buy" | "sell";
  exposure: number;
  collateral: number;
  fee: number;
  liquidation: number;
}) {
  const outcome = (field: "tp" | "sl" | "trailing") => {
    const target = Math.round(Number(values[field]) * 10000);
    const entry = Math.round(price * 10000);
    if (
      field === "trailing" ||
      !Number.isSafeInteger(target) ||
      target <= 0 ||
      entry <= 0 ||
      !exposure
    )
      return null;
    if (
      field === "sl" &&
      (side === "buy" ? target <= liquidation : target >= liquidation)
    )
      return "Liquidation takes priority before this level.";
    try {
      const gross = Math.max(
        -collateral,
        pnlCents(entry, target, exposure, side),
      );
      const exitFee = Math.min(fee, collateral + gross);
      return `At level: ${signedMoney(gross)} gross / ${signedMoney(gross - fee - exitFee)} estimated net. Slippage can change the result.`;
    } catch {
      return "Target exceeds the supported valuation range.";
    }
  };
  return (
    <details className="protection">
      <summary>
        Protection{" "}
        <span>
          {[
            values.tp && "TP",
            values.sl && "SL",
            values.trailing && "Trailing stop",
          ]
            .filter(Boolean)
            .join(", ") || "Optional"}
        </span>
      </summary>
      <p className="muted">
        Levels are market prices in USD. Stops use simulated quotes and may fill
        beyond your level during a gap.
      </p>
      {(
        [
          ["tp", "Take profit price"],
          ["sl", "Stop loss price"],
          ["trailing", "Trailing distance (USD)"],
        ] as const
      ).map(([field, label]) => (
        <label key={field}>
          {label}
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={values[field]}
            placeholder={
              field === "trailing"
                ? `e.g. ${Math.min(price * 0.01, Math.abs(price - liquidation / 10000) * 0.25).toFixed(2)}`
                : "Off"
            }
            onChange={(e) => onChange({ ...values, [field]: e.target.value })}
          />
          {values[field] && outcome(field) && <small>{outcome(field)}</small>}
          {field === "trailing" && values.trailing && (
            <small>
              {((Number(values.trailing) / price) * 100).toFixed(2)}% of the
              current price
            </small>
          )}
        </label>
      ))}
      <small>
        Clear a field to turn it off. Changing market or side resets protection.
      </small>
    </details>
  );
}
