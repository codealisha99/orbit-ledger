import { money, quantity } from "@orbitledger/shared";
export default function TradePreview({
  margin,
  fee,
  exposure,
  price,
  liquidation,
}: {
  margin: number;
  fee: number;
  exposure: number;
  price: number;
  liquidation: number;
}) {
  return (
    <dl className="trade-preview">
      <div>
        <dt>Collateral reserved</dt>
        <dd>{money(margin)}</dd>
      </div>
      <div>
        <dt>Opening fee (0.5% of collateral)</dt>
        <dd>{money(fee)}</dd>
      </div>
      <div className="preview-total">
        <dt>Cash required</dt>
        <dd>{money(margin + fee)}</dd>
      </div>
      <div>
        <dt>Notional exposure</dt>
        <dd>{money(exposure)}</dd>
      </div>
      <div>
        <dt>Base quantity</dt>
        <dd>{price > 0 ? quantity(exposure, price).toFixed(6) : "—"}</dd>
      </div>
      <div>
        <dt>Estimated liquidation</dt>
        <dd>{price > 0 ? money(liquidation / 100) : "—"}</dd>
      </div>
      <div>
        <dt>Estimated exit fee</dt>
        <dd>{money(fee)}</dd>
      </div>
    </dl>
  );
}
