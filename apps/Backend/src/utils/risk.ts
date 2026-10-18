export function shouldClosePosition(
  order: {
    type: string;
    liquidationPrice: number;
    stopLoss?: number | null;
    takeProfit?: number | null;
  },
  price: number,
) {
  const long = order.type === "buy";
  if (long ? price <= order.liquidationPrice : price >= order.liquidationPrice)
    return { reason: "liquidation" as const, price };
  if (
    order.stopLoss &&
    (long ? price <= order.stopLoss : price >= order.stopLoss)
  )
    return { reason: "stop_loss" as const, price };
  if (
    order.takeProfit &&
    (long ? price >= order.takeProfit : price <= order.takeProfit)
  )
    return { reason: "take_profit" as const, price };
  return null;
}
