import type { AnalyticsChartPoint } from '@/lib/analytics/detail-view';
import { formatShortAnalyticsDate } from '@/lib/analytics/detail-view';

const WIDTH = 320;
const HEIGHT = 174;
const LEFT = 48;
const RIGHT = 12;
const TOP = 18;
const BOTTOM = 32;

export function TrendChart({
  points,
  label,
  formatValue,
}: {
  points: AnalyticsChartPoint[];
  label: string;
  formatValue: (value: number) => string;
}) {
  if (points.length === 0) {
    return (
      <div className="grid min-h-44 place-items-center rounded-2xl bg-muted/45 px-5 text-center">
        <div>
          <p className="font-bold">この期間に記録がありません</p>
          <p className="mt-1 text-sm text-muted-foreground">
            期間を広げると表示できる場合があります。
          </p>
        </div>
      </div>
    );
  }

  if (points.length === 1) {
    return (
      <div className="grid min-h-44 place-items-center rounded-2xl bg-muted/45 px-5 text-center">
        <div>
          <p className="text-2xl font-black">{formatValue(points[0].value)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatShortAnalyticsDate(points[0].localDate)}の記録
          </p>
          <p className="mt-3 text-sm font-medium">
            あと1回記録すると推移が見やすくなります
          </p>
        </div>
      </div>
    );
  }

  const values = points.map((point) => point.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = rawMax === rawMin ? Math.max(rawMax * 0.05, 1) : 0;
  const min = rawMin - padding;
  const max = rawMax + padding;
  const x = (index: number) =>
    LEFT + (index / (points.length - 1)) * (WIDTH - LEFT - RIGHT);
  const y = (value: number) =>
    TOP + ((max - value) / (max - min)) * (HEIGHT - TOP - BOTTOM);
  const coordinates = points
    .map((point, index) => `${x(index)},${y(point.value)}`)
    .join(' ');

  return (
    <figure className="rounded-2xl bg-muted/35 px-2 pb-2 pt-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-48 w-full"
        aria-label={`${label}の推移。${points.length}件の記録`}
      >
        {[TOP, (TOP + HEIGHT - BOTTOM) / 2, HEIGHT - BOTTOM].map((lineY) => (
          <line
            key={lineY}
            x1={LEFT}
            x2={WIDTH - RIGHT}
            y1={lineY}
            y2={lineY}
            className="stroke-border"
            strokeDasharray="3 5"
          />
        ))}
        <text x="2" y={TOP + 4} className="fill-muted-foreground text-[11px]">
          {formatValue(rawMax)}
        </text>
        <text
          x="2"
          y={HEIGHT - BOTTOM + 4}
          className="fill-muted-foreground text-[11px]"
        >
          {formatValue(rawMin)}
        </text>
        <polyline
          points={coordinates}
          fill="none"
          className="stroke-primary"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((point, index) => (
          <circle
            key={`${point.key}-${index}`}
            cx={x(index)}
            cy={y(point.value)}
            r={index === points.length - 1 ? 4.5 : 3.5}
            className="fill-background stroke-primary"
            strokeWidth="2.5"
          />
        ))}
        <text
          x={LEFT}
          y={HEIGHT - 8}
          textAnchor="start"
          className="fill-muted-foreground text-[11px]"
        >
          {formatShortAnalyticsDate(points[0].localDate)}
        </text>
        <text
          x={WIDTH - RIGHT}
          y={HEIGHT - 8}
          textAnchor="end"
          className="fill-muted-foreground text-[11px]"
        >
          {formatShortAnalyticsDate(points.at(-1)?.localDate ?? '')}
        </text>
      </svg>
      <figcaption className="px-3 text-right text-sm font-bold">
        最新 {formatValue(points.at(-1)?.value ?? 0)}
      </figcaption>
    </figure>
  );
}
