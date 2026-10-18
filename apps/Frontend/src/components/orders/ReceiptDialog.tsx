"use client";
import { useEffect, useRef } from "react";
import { money, signedMoney } from "@orbitledger/shared";
import type { Position, Execution, AccountEvent } from "@/lib/account";
import { price, date } from "./format";
export interface Receipt {
  id: string;
  events: AccountEvent[];
  executions: Execution[];
}
export default function ReceiptDialog({
  receipt,
  onClose,
}: {
  receipt: Receipt | null;
  onClose: () => void;
}) {
  const receiptDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (receipt) receiptDialog.current?.showModal();
  }, [receipt]);
  return (
    <dialog
      ref={receiptDialog}
      aria-labelledby="receipt-dialog-title"
      className="receipt-dialog"
      onClose={() => onClose()}
    >
      <div className="section-heading">
        <h2 id="receipt-dialog-title">Position receipt</h2>
        <button
          autoFocus
          onClick={() => receiptDialog.current?.close()}
          aria-label="Close receipt"
        >
          ×
        </button>
      </div>
      <p className="receipt-id">{receipt?.id}</p>
      <h3>Executions</h3>
      {receipt?.executions.length === 0 && <p>No exits recorded yet.</p>}
      {receipt?.executions.map((e) => (
        <dl className="trade-preview" key={e.orderId}>
          <div>
            <dt>
              {e.closeReason} · {date(e.closedAt)} UTC
            </dt>
            <dd>
              {e.feesRecorded && e.netPnlCents !== null
                ? signedMoney(e.netPnlCents) + " net"
                : "Legacy fees unknown"}
            </dd>
          </div>
          <div>
            <dt>Gross P&L</dt>
            <dd>{signedMoney(e.pnl)}</dd>
          </div>
          <div>
            <dt>Allocated entry costs / exit fee</dt>
            <dd>
              {money(e.entryFeeCents)} / {money(e.exitFeeCents)}
            </dd>
          </div>
          <div>
            <dt>Exit price / exposure closed</dt>
            <dd>
              {price(e.closePrice)} /{" "}
              {e.feesRecorded
                ? money(e.notionalCents)
                : "Legacy exposure unverified"}
            </dd>
          </div>
        </dl>
      ))}
      <h3>Account lifecycle</h3>
      {receipt?.events.map((event) => (
        <details key={event.id}>
          <summary>
            {event.kind.replaceAll("_", " ")} · {date(event.createdAt)} UTC
          </summary>
          <EventDetails event={event} />
        </details>
      ))}
    </dialog>
  );
}
function EventDetails({ event }: { event: AccountEvent }) {
  const payload = event.payload as {
    order?: Position;
    execution?: Execution;
    feeCents?: number;
    collateralAddedCents?: number;
    stopLoss?: number;
  };
  const order = payload.order;
  const exit = payload.execution;
  return (
    <dl className="trade-preview">
      {order && (
        <>
          <div>
            <dt>Market / side</dt>
            <dd>
              {order.asset} {order.type === "buy" ? "long" : "short"}
            </dd>
          </div>
          <div>
            <dt>Collateral / exposure</dt>
            <dd>
              {money(order.margin)} / {money(order.notionalCents)}
            </dd>
          </div>
          <div>
            <dt>Take profit / stop loss</dt>
            <dd>
              {price(order.takeProfit)} / {price(order.stopLoss)}
            </dd>
          </div>
        </>
      )}
      {exit && (
        <>
          <div>
            <dt>Closed exposure</dt>
            <dd>{money(exit.notionalCents)}</dd>
          </div>
          <div>
            <dt>Exit quote</dt>
            <dd>{price(exit.closePrice)}</dd>
          </div>
          <div>
            <dt>Gross / net P&L</dt>
            <dd>
              {signedMoney(exit.pnl)} /{" "}
              {exit.feesRecorded && exit.netPnlCents !== null
                ? signedMoney(exit.netPnlCents)
                : "Unknown legacy costs"}
            </dd>
          </div>
        </>
      )}
      {payload.feeCents !== undefined && (
        <div>
          <dt>Fee paid</dt>
          <dd>{money(payload.feeCents)}</dd>
        </div>
      )}
      {payload.collateralAddedCents !== undefined && (
        <div>
          <dt>Collateral added</dt>
          <dd>{money(payload.collateralAddedCents)}</dd>
        </div>
      )}
      {payload.stopLoss !== undefined && (
        <div>
          <dt>Updated stop loss</dt>
          <dd>{price(payload.stopLoss)}</dd>
        </div>
      )}
      <div>
        <dt>Receipt</dt>
        <dd>{event.id.slice(0, 8)}</dd>
      </div>
    </dl>
  );
}
