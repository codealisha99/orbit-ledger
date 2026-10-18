import type { UTCTimestamp } from "lightweight-charts";

import type { IChartApi } from "lightweight-charts";

export function StayonTimeline(
  chart: IChartApi,
  candlestickSeries: { data: () => any },
  winsowSize: number = 50,
): void {
  const timetoScale = chart.timeScale();
  const position = timetoScale.scrollPosition();

  if (Math.abs(position) < 1) {
    const bars = candlestickSeries.data();
    if (bars && bars.length > winsowSize) {
      timetoScale.setVisibleRange({
        from: bars[bars.length - winsowSize].time as UTCTimestamp,
        to: bars[bars.length - 1].time as UTCTimestamp,
      });
    }
  }
}
