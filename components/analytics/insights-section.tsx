'use client';

import { useState } from 'react';
import type { AnalyticsInsightSummary } from '@/lib/analytics/insights';
import { Card, CardContent } from '@/components/ui/card';
import { APP_ROUTES } from '@/lib/routes';

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
  exerciseLinks = false,
  compact = false,
}: {
  summary: AnalyticsInsightSummary;
  detailed?: boolean;
  exerciseLinks?: boolean;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems =
    compact && !expanded ? summary.items.slice(0, 3) : summary.items;
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
            {visibleItems.map((item) => {
              const content = (
                <div
                  className={
                    exerciseLinks && item.exerciseId
                      ? 'rounded-r-xl py-2 pr-2 transition hover:bg-muted/60'
                      : undefined
                  }
                >
                  <p
                    className={`text-sm font-bold ${item.achievement || item.type === 'recent_pr' ? 'text-emerald-700 dark:text-emerald-400' : ''}`}
                  >
                    {item.title}
                  </p>
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
                </div>
              );
              return (
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
                  {exerciseLinks && item.exerciseId ? (
                    <a
                      className="block min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      href={APP_ROUTES.analyticsExercise(item.exerciseId)}
                      aria-label={`${item.exerciseName ?? item.title}の詳細分析を見る`}
                    >
                      {content}
                    </a>
                  ) : (
                    content
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {compact && summary.items.length > 3 && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className="mt-3 min-h-11 text-sm font-bold text-primary"
          >
            {expanded
              ? '3件に戻す'
              : `もっと見る（全${summary.items.length}件）`}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
