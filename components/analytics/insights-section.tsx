import type { AnalyticsInsightSummary } from '@/lib/analytics/insights';
import { Card, CardContent } from '@/components/ui/card';

const evidenceLabels: Record<string, string> = {
  weight: '重量',
  reps: 'rep',
  e1rm: 'e1RM',
  volume: 'Volume',
  targetLoad: '目標重量',
  evaluatedWorkingSets: '達成判定セット数',
};

function supportingValue(value: number | string, unit?: string) {
  if (typeof value === 'string') return value;
  const display =
    unit === 'grams' || unit === 'gram_reps' ? value / 1000 : value;
  const suffix =
    unit === 'grams' || unit === 'gram_reps'
      ? 'kg'
      : unit === 'reps'
        ? '回'
        : unit === 'sets'
          ? 'sets'
          : '';
  return `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(display)}${suffix}`;
}

export function InsightsSection({
  summary,
  detailed = false,
}: {
  summary: AnalyticsInsightSummary;
  detailed?: boolean;
}) {
  return (
    <Card className="rounded-3xl py-5 shadow-none">
      <CardContent className="px-5">
        <h3 className="font-black">今のポイント</h3>
        {summary.items.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {summary.status === 'insufficient_data'
              ? 'まだ分析に十分な記録がありません'
              : '現在、特に注目すべき変化はありません'}
          </p>
        ) : (
          <ul className="mt-3 space-y-4">
            {summary.items.map((item) => (
              <li
                key={item.id}
                className="border-l-2 pl-3"
                style={{
                  borderColor:
                    item.priority === 'high'
                      ? 'var(--color-amber-500)'
                      : 'var(--primary)',
                }}
              >
                <p className="text-sm font-bold">{item.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.message}
                </p>
                {detailed && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {item.supportingData.values
                      .filter(
                        (value) => value.unit && value.unit !== 'workouts',
                      )
                      .map((value, index) => (
                        <span
                          key={`${value.label}-${index}`}
                          className="mr-3 inline-block"
                        >
                          {value.date ? `${value.date} ` : ''}
                          {evidenceLabels[value.label] ?? value.label}:{' '}
                          {supportingValue(value.value, value.unit)}
                        </span>
                      ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
